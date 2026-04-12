import { spawn } from 'child_process';
import { loadHooksSettingsFromProject, loadHooksSettingsFromUser } from './loader.js';
import { matchTool, matchesHookIfClause } from './hook-if.js';
import { parsePreToolUseCommandOutput } from './parse-output.js';
import type {
  CommandHookConfig,
  FunctionHook,
  HookCommandStdin,
  HookContext,
  HookEventType,
  HookGroupConfig,
  HookResult,
  HooksSettings
} from './types.js';

/** 扁平化的文件 command hook（含 matcher） */
export interface FlatCommandHookEntry {
  matcher?: string;
  hook: CommandHookConfig;
}

function emptyHooksRecord(): Record<HookEventType, HookGroupConfig[]> {
  return {
    preToolUse: [],
    postToolUse: [],
    postToolUseFailure: []
  };
}

function toUpperSnake(paramName: string): string {
  return paramName
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
}

export function buildHookEnv(context: HookContext): NodeJS.ProcessEnv {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  env.CLAUDE_TOOL_NAME = context.toolName;
  if (context.toolCallId) env.CLAUDE_TOOL_CALL_ID = context.toolCallId;
  if (context.projectDir) env.CLAUDE_PROJECT_DIR = context.projectDir;
  env.CLAUDE_HOOK_EVENT = context.eventType;
  for (const [k, v] of Object.entries(context.toolInput)) {
    const key = `CLAUDE_TOOL_INPUT_${toUpperSnake(k)}`;
    env[key] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return env;
}

function buildStdinPayload(context: HookContext): HookCommandStdin {
  const payload: HookCommandStdin = {
    hook_event: context.eventType,
    tool_name: context.toolName,
    tool_input: context.toolInput
  };
  if (context.toolCallId) payload.tool_call_id = context.toolCallId;
  if (context.projectDir) payload.project_dir = context.projectDir;
  if (context.toolResultRaw) {
    payload.tool_result_raw = {
      content: context.toolResultRaw.content,
      isError: context.toolResultRaw.isError
    };
  }
  if (context.toolResultFinal) {
    payload.tool_result_final = {
      content: context.toolResultFinal.content,
      isError: context.toolResultFinal.isError
    };
  }
  if (context.errorMessage) payload.error_message = context.errorMessage;
  if (context.failureKind) payload.failure_kind = context.failureKind;
  return payload;
}

/**
 * 将 HookGroup[] 展开为带 matcher 的条目列表（保持组内顺序）
 */
function flattenGroups(groups: HookGroupConfig[]): FlatCommandHookEntry[] {
  const out: FlatCommandHookEntry[] = [];
  for (const g of groups) {
    for (const hook of g.hooks) {
      out.push({ matcher: g.matcher, hook });
    }
  }
  return out;
}

/**
 * 合并项目层与用户层 command hook（§6.3）
 */
export function mergeCommandHookLayers(
  project: HookGroupConfig[],
  user: HookGroupConfig[]
): FlatCommandHookEntry[] {
  const projectFlat = flattenGroups(project);
  const userFlat = flattenGroups(user);

  const projectNoId: FlatCommandHookEntry[] = [];
  const idMap = new Map<string, FlatCommandHookEntry>();

  for (const e of projectFlat) {
    if (e.hook.id) {
      idMap.set(e.hook.id, e);
    } else {
      projectNoId.push(e);
    }
  }

  const userNoId: FlatCommandHookEntry[] = [];
  for (const e of userFlat) {
    if (e.hook.id) {
      idMap.set(e.hook.id, e);
    } else {
      userNoId.push(e);
    }
  }

  return [...projectNoId, ...userNoId, ...idMap.values()];
}

function mergeDisableAll(project?: boolean, user?: boolean): boolean {
  return project === true || user === true;
}

function runSpawnWithStdin(
  command: string,
  env: NodeJS.ProcessEnv,
  stdinBody: string,
  timeoutSec: number
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderr = '';
    let stdout = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf-8');
    });
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf-8');
    });

    const timeoutMs = Math.max(1, timeoutSec) * 1000;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stderr, stdout });
    });

    try {
      child.stdin?.write(stdinBody, 'utf-8');
      child.stdin?.end();
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

function parseReasonFromStderr(stderr: string): string | undefined {
  const trimmed = stderr.trim();
  if (!trimmed) return undefined;
  try {
    const j = JSON.parse(trimmed) as { reason?: string };
    if (typeof j.reason === 'string') return j.reason;
  } catch {
    /* ignore */
  }
  return trimmed;
}

export class HookManager {
  private runtimeEnabled = true;
  private mergedDisableAll = false;
  private mergedHooks: Record<HookEventType, FlatCommandHookEntry[]> = {
    preToolUse: [],
    postToolUse: [],
    postToolUseFailure: []
  };
  private functionHooks = new Map<string, FunctionHook>();
  private projectHooks: HooksSettings = this.emptySettings();
  private userHooks: HooksSettings = this.emptySettings();

  private emptySettings(): HooksSettings {
    return {
      disableAllHooks: false,
      hooks: emptyHooksRecord()
    };
  }

  private rebuildMerged(): void {
    const events: HookEventType[] = ['preToolUse', 'postToolUse', 'postToolUseFailure'];
    for (const ev of events) {
      this.mergedHooks[ev] = mergeCommandHookLayers(
        this.projectHooks.hooks[ev],
        this.userHooks.hooks[ev]
      );
    }
    this.mergedDisableAll = mergeDisableAll(
      this.projectHooks.disableAllHooks,
      this.userHooks.disableAllHooks
    );
  }

  private shouldRunHooks(): boolean {
    if (!this.runtimeEnabled) return false;
    if (this.mergedDisableAll) return false;
    return true;
  }

  private getHooksForEvent(event: HookEventType): FlatCommandHookEntry[] {
    return this.mergedHooks[event] ?? [];
  }

  private getFunctionHooksForEvent(event: HookEventType): FunctionHook[] {
    return [...this.functionHooks.values()].filter(h => h.event === event);
  }

  private async runCommandHook(
    cmd: CommandHookConfig,
    context: HookContext,
    phase: 'pre' | 'post'
  ): Promise<HookResult | void> {
    const env = buildHookEnv(context);
    const stdinBody = JSON.stringify(buildStdinPayload(context));
    const timeoutSec = cmd.timeout ?? 30;

    try {
      const { code, stderr, stdout } = await runSpawnWithStdin(cmd.command, env, stdinBody, timeoutSec);
      if (phase === 'pre') {
        const parsed = parsePreToolUseCommandOutput(stdout);
        if (parsed !== null) {
          return parsed;
        }
        if (code === 0) return { allowed: true };
        if (code === 2) {
          return {
            allowed: false,
            reason: parseReasonFromStderr(stderr) ?? 'Hook blocked tool execution'
          };
        }
        console.error(
          `[HookManager] PreToolUse command exited with code ${code}: ${stderr || cmd.command}`
        );
        return {
          allowed: false,
          reason: parseReasonFromStderr(stderr) ?? `Hook process exited with code ${code}`
        };
      }
      if (code !== 0 && code !== null) {
        console.error(`[HookManager] Post* hook non-zero exit (${code}): ${stderr || cmd.command}`);
      }
    } catch (err) {
      console.error(`[HookManager] Command hook failed: ${cmd.command}`, err);
      if (phase === 'pre') {
        return {
          allowed: false,
          reason: err instanceof Error ? err.message : String(err)
        };
      }
    }
  }

  private fireAsyncCommandHook(cmd: CommandHookConfig, context: HookContext): void {
    const env = buildHookEnv(context);
    const stdinBody = JSON.stringify(buildStdinPayload(context));
    const timeoutSec = cmd.timeout ?? 30;
    void runSpawnWithStdin(cmd.command, env, stdinBody, timeoutSec)
      .then(({ code, stderr }) => {
        if (code !== 0 && code !== null) {
          console.error(`[HookManager] async hook exit (${code}): ${stderr || cmd.command}`);
        }
      })
      .catch(err => {
        console.error(`[HookManager] async hook error: ${cmd.command}`, err);
      });
  }

  private async runFunctionHookSafe(
    hook: FunctionHook,
    context: HookContext,
    phase: 'pre' | 'post'
  ): Promise<HookResult | void> {
    try {
      return await hook.handler(context);
    } catch (err) {
      console.error(`[HookManager] Function hook "${hook.id}" threw`, err);
      if (phase === 'pre') {
        return {
          allowed: false,
          reason: err instanceof Error ? err.message : String(err)
        };
      }
    }
  }

  register(hook: FunctionHook): void {
    this.functionHooks.set(hook.id, hook);
  }

  unregister(id: string): boolean {
    return this.functionHooks.delete(id);
  }

  async loadProjectConfig(projectDir: string): Promise<void> {
    this.projectHooks = await loadHooksSettingsFromProject(projectDir);
    this.rebuildMerged();
  }

  async loadUserConfig(userBasePath?: string): Promise<void> {
    this.userHooks = await loadHooksSettingsFromUser(userBasePath);
    this.rebuildMerged();
  }

  /**
   * @param projectDir 项目根（其下 `.claude/settings.json` 为项目层 hooks）
   * @param userBasePath 用户根（其下 `.claude/settings.json` 为用户层 hooks）；与 {@link AgentConfig.userBasePath} 一致，省略则为 `homedir()`
   */
  async discoverAndLoad(projectDir?: string, userBasePath?: string): Promise<void> {
    const dir = projectDir ?? process.cwd();
    await this.loadProjectConfig(dir);
    await this.loadUserConfig(userBasePath);
  }

  setEnabled(enabled: boolean): void {
    this.runtimeEnabled = enabled;
  }

  isEnabled(): boolean {
    return this.runtimeEnabled;
  }

  async executePreToolUse(context: HookContext): Promise<HookResult> {
    if (!this.shouldRunHooks()) {
      return { allowed: true, updatedInput: { ...context.toolInput } };
    }

    let workingInput = { ...context.toolInput };

    for (const entry of this.getHooksForEvent('preToolUse')) {
      if (!matchTool(context.toolName, entry.matcher)) continue;
      if (!matchesHookIfClause(context.toolName, workingInput, entry.hook.if)) continue;
      const ctx = { ...context, toolInput: workingInput };
      const result = await this.runCommandHook(entry.hook, ctx, 'pre');
      if (result?.allowed === false) {
        return { allowed: false, reason: result.reason };
      }
      if (result?.updatedInput) {
        workingInput = { ...workingInput, ...result.updatedInput };
      }
    }

    for (const fh of this.getFunctionHooksForEvent('preToolUse')) {
      if (!matchTool(context.toolName, fh.matcher)) continue;
      const ctx = { ...context, toolInput: workingInput };
      const result = await this.runFunctionHookSafe(fh, ctx, 'pre');
      if (result?.allowed === false) {
        return { allowed: false, reason: result.reason };
      }
      if (result?.updatedInput) {
        workingInput = { ...workingInput, ...result.updatedInput };
      }
    }

    return { allowed: true, updatedInput: workingInput };
  }

  async executePostToolUse(context: HookContext): Promise<void> {
    if (!this.shouldRunHooks()) return;

    for (const entry of this.getHooksForEvent('postToolUse')) {
      if (!matchTool(context.toolName, entry.matcher)) continue;
      if (!matchesHookIfClause(context.toolName, context.toolInput, entry.hook.if)) continue;
      if (entry.hook.async) {
        this.fireAsyncCommandHook(entry.hook, context);
        continue;
      }
      await this.runCommandHook(entry.hook, context, 'post');
    }

    for (const fh of this.getFunctionHooksForEvent('postToolUse')) {
      if (!matchTool(context.toolName, fh.matcher)) continue;
      await this.runFunctionHookSafe(fh, context, 'post');
    }
  }

  async executePostToolUseFailure(context: HookContext): Promise<void> {
    if (!this.shouldRunHooks()) return;

    for (const entry of this.getHooksForEvent('postToolUseFailure')) {
      if (!matchTool(context.toolName, entry.matcher)) continue;
      if (!matchesHookIfClause(context.toolName, context.toolInput, entry.hook.if)) continue;
      if (entry.hook.async) {
        this.fireAsyncCommandHook(entry.hook, context);
        continue;
      }
      await this.runCommandHook(entry.hook, context, 'post');
    }

    for (const fh of this.getFunctionHooksForEvent('postToolUseFailure')) {
      if (!matchTool(context.toolName, fh.matcher)) continue;
      await this.runFunctionHookSafe(fh, context, 'post');
    }
  }

  static create(): HookManager {
    return new HookManager();
  }
}

export function createFunctionHook(config: {
  id: string;
  event: HookEventType;
  matcher?: string;
  description?: string;
  handler: (context: HookContext) => Promise<HookResult | void>;
}): FunctionHook {
  return {
    id: config.id,
    event: config.event,
    matcher: config.matcher,
    description: config.description,
    handler: config.handler
  };
}
