import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Agent,
  createFileJSONLLogger,
  createModel,
  loadMCPConfig,
  validateMCPConfig,
  type AskUserQuestionResolver,
  type FileJSONLLogger,
  type MCPConfigFile,
  type MCPServerConfig,
  type SDKLogLevel
} from '@ddlqhd/agent-sdk';
import type { ModelProvider } from '../shared/ws-protocol.js';
import { truncateForLog } from '../shared/log-utils.js';
import { describeMissingKey, getOllamaBaseUrl, requireProviderEnv } from './env.js';
import { demoCalculatorTool } from './demo-calculator.js';
import { DEMO_FIXTURES, SDK_ROOT, WEB_DEMO_LOG_DIR, WEB_DEMO_ROOT } from './paths.js';

const LOG_PREFIX = '[web-demo]';

const VALID_LOG_LEVELS: SDKLogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

function resolveSharedLogLevel(): SDKLogLevel {
  const raw = process.env.AGENT_SDK_LOG_LEVEL?.trim().toLowerCase();
  if (raw && (VALID_LOG_LEVELS as string[]).includes(raw)) {
    return raw as SDKLogLevel;
  }
  return 'info';
}

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function resolveSharedLogFile(): string {
  const fromEnv = process.env.AGENT_SDK_LOG_FILE?.trim();
  if (fromEnv) return fromEnv;
  return join(WEB_DEMO_LOG_DIR, `agent-sdk-${todayStamp()}.log`);
}

let sharedLogger: FileJSONLLogger | null = null;
let sharedLoggerInitialized = false;

interface SharedLoggerInfo {
  logger: FileJSONLLogger | null;
  level: SDKLogLevel;
  filePath: string | null;
}

/**
 * Lazily create a process-wide JSONL logger for SDK events. Returns `null` for the logger when
 * `AGENT_SDK_LOG_LEVEL=silent`. The level and file path are always reported so callers can log
 * the chosen settings.
 */
export function getSharedAgentLogger(): SharedLoggerInfo {
  const level = resolveSharedLogLevel();
  if (level === 'silent') {
    return { logger: null, level, filePath: null };
  }
  if (!sharedLoggerInitialized) {
    sharedLoggerInitialized = true;
    sharedLogger = createFileJSONLLogger({ filePath: resolveSharedLogFile() });
  }
  return {
    logger: sharedLogger,
    level,
    filePath: sharedLogger?.filePath ?? null
  };
}

/** Flush + close the shared SDK logger. Idempotent and safe to call during shutdown. */
export async function closeSharedAgentLogger(): Promise<void> {
  const current = sharedLogger;
  sharedLogger = null;
  sharedLoggerInitialized = false;
  if (current) {
    await current.close();
  }
}

export interface BuildAgentOptions {
  provider: ModelProvider;
  model: string;
  temperature?: number;
  /** ContextManager 上下文窗口覆盖；仅在 `contextManagement !== false` 时传入 Agent */
  contextLength?: number;
  storage: 'memory' | 'jsonl';
  safeToolsOnly?: boolean;
  /** Long-term CLAUDE.md memory; omit for SDK default (on) */
  memory?: boolean;
  /** false disables context compression; true/omit enables with defaults */
  contextManagement?: boolean;
  /** Maps to AgentModelConfig.thinking; omit for provider default. */
  thinking?: boolean;
  /** → AgentModelConfig.thinkingLevel; `createModel` / adapters use when supported (e.g. Ollama `think`). */
  thinkingLevel?: 'low' | 'medium' | 'high';
  mcpConfigPath?: string;
  cwd?: string;
  userBasePath?: string;
  /** AskUserQuestion 交互（例如 WebSocket 宿主注入） */
  askUserQuestion?: AskUserQuestionResolver;
}

function ensureSdkBuilt(): void {
  const distJs = join(SDK_ROOT, 'dist', 'index.js');
  if (!existsSync(distJs)) {
    throw new Error(
      `@ddlqhd/agent-sdk is not built. From the repository root run: pnpm build\nExpected: ${distJs}`
    );
  }
}

function resolvePathRelative(p: string, base: string): string {
  if (!p || !p.trim()) return base;
  const trimmed = p.trim();
  if (existsSync(trimmed)) return trimmed;
  const underDemo = join(WEB_DEMO_ROOT, trimmed);
  if (existsSync(underDemo)) return underDemo;
  return join(base, trimmed);
}

/**
 * Build an {@link Agent}, wait for init (built-ins / MCP).
 * Demo calculator is passed via {@link AgentConfig.tools} (appended to built-ins).
 * When `safeToolsOnly`, {@link AgentConfig.disallowedTools} hides `Bash` from the model; any
 * remaining dangerous tools (e.g. from MCP) are unregistered after init.
 */
export async function buildAgent(config: BuildAgentOptions): Promise<{ agent: Agent; warnings: string[] }> {
  ensureSdkBuilt();

  const warnings: string[] = [];
  const key = requireProviderEnv(config.provider);
  if (config.provider !== 'ollama' && !key) {
    throw new Error(describeMissingKey(config.provider));
  }

  const cwd =
    config.cwd && config.cwd.trim() !== ''
      ? resolvePathRelative(config.cwd, DEMO_FIXTURES)
      : DEMO_FIXTURES;
  const userBasePath =
    config.userBasePath && config.userBasePath.trim() !== ''
      ? resolvePathRelative(config.userBasePath, WEB_DEMO_ROOT)
      : mkdtempSync(join(tmpdir(), 'agent-sdk-demo-'));

  const model = createModel({
    provider: config.provider,
    apiKey: key,
    baseUrl: config.provider === 'ollama' ? getOllamaBaseUrl() : undefined,
    model: config.model,
    ...(config.thinking !== undefined ? { thinking: config.thinking } : {}),
    ...(config.thinkingLevel !== undefined ? { thinkingLevel: config.thinkingLevel } : {})
  });
  let mcpServers: MCPServerConfig[] | undefined;
  if (config.mcpConfigPath && config.mcpConfigPath.trim() !== '') {
    const mcpPath = resolvePathRelative(config.mcpConfigPath, WEB_DEMO_ROOT);
    if (!existsSync(mcpPath)) {
      warnings.push(`MCP config not found: ${config.mcpConfigPath}`);
    } else {
      try {
        const raw = JSON.parse(readFileSync(mcpPath, 'utf-8')) as MCPConfigFile;
        const errs = validateMCPConfig(raw);
        if (errs.length > 0) {
          warnings.push(`MCP validation: ${errs.join('; ')}`);
        } else {
          const { servers } = loadMCPConfig(mcpPath, WEB_DEMO_ROOT, userBasePath);
          if (servers.length === 0) {
            warnings.push('MCP config loaded but no servers defined.');
          } else {
            mcpServers = servers;
          }
        }
      } catch (e) {
        warnings.push(`MCP load error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const mcpRelatedWarnings = warnings.filter((w) => /mcp/i.test(w));
  console.log(
    `${LOG_PREFIX} buildAgent cwd=${truncateForLog(cwd)} userBasePath=${truncateForLog(userBasePath)} mcpServers=${mcpServers?.length ?? 0}`
  );
  if (mcpRelatedWarnings.length > 0) {
    console.warn(
      `${LOG_PREFIX} buildAgent MCP warnings (${mcpRelatedWarnings.length}): ${mcpRelatedWarnings.map((w) => truncateForLog(w, 160)).join(' | ')}`
    );
  }

  const sharedLog = getSharedAgentLogger();
  const contextManagement =
    config.contextManagement === false
      ? false
      : config.contextLength != null
        ? { contextLength: config.contextLength }
        : {};

  const agent = new Agent({
    model,
    cwd,
    userBasePath,
    storage: { type: config.storage },
    temperature: config.temperature,
    memory: config.memory,
    contextManagement,
    mcpServers,
    skillConfig: {
      autoLoad: true,
      workspacePath: join(cwd, '.claude', 'skills')
    },
    includeEnvironment: true,
    askUserQuestion: config.askUserQuestion,
    tools: [demoCalculatorTool],
    disallowedTools: config.safeToolsOnly ? ['Bash'] : undefined,
    logLevel: sharedLog.level,
    ...(sharedLog.logger ? { logger: sharedLog.logger } : {})
  });

  await agent.waitForInit();
  if (config.safeToolsOnly) {
    const reg = agent.getToolRegistry();
    for (const tool of [...reg.getAll()]) {
      if (tool.isDangerous) {
        reg.unregister(tool.name);
      }
    }
  }

  return { agent, warnings };
}
