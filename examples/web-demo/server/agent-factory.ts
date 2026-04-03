import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Agent,
  createModel,
  loadMCPConfig,
  validateMCPConfig,
  type AskUserQuestionResolver,
  type MCPConfigFile,
  type MCPServerConfig
} from 'agent-sdk';
import type { ModelProvider } from '../shared/ws-protocol.js';
import { truncateForLog } from '../shared/log-utils.js';
import { describeMissingKey, getOllamaBaseUrl, requireProviderEnv } from './env.js';
import { demoCalculatorTool } from './demo-calculator.js';
import { DEMO_FIXTURES, SDK_ROOT, WEB_DEMO_ROOT } from './paths.js';

const LOG_PREFIX = '[web-demo]';

export interface BuildAgentOptions {
  provider: ModelProvider;
  model: string;
  temperature?: number;
  maxTokens?: number;
  storage: 'memory' | 'jsonl';
  safeToolsOnly?: boolean;
  /** Long-term CLAUDE.md memory; omit for SDK default (on) */
  memory?: boolean;
  /** false disables context compression; true/omit enables with defaults */
  contextManagement?: boolean;
  /** Ollama only: passed to `createModel` as `think`. */
  ollamaThink?: boolean | 'low' | 'medium' | 'high';
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
      `agent-sdk is not built. From the repository root run: pnpm build\nExpected: ${distJs}`
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
    ...(config.provider === 'ollama' && config.ollamaThink !== undefined
      ? { think: config.ollamaThink }
      : {})
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

  const agent = new Agent({
    model,
    cwd,
    userBasePath,
    storage: { type: config.storage },
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    memory: config.memory,
    contextManagement: config.contextManagement === false ? false : {},
    mcpServers,
    skillConfig: {
      autoLoad: true,
      workspacePath: join(cwd, '.claude', 'skills')
    },
    includeEnvironment: true,
    askUserQuestion: config.askUserQuestion,
    tools: [demoCalculatorTool],
    disallowedTools: config.safeToolsOnly ? ['Bash'] : undefined
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
