import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  createFileJSONLLogger,
  loadMCPConfig,
  validateMCPConfig,
  type Agent,
  type AskUserQuestionResolver,
  type FileJSONLLogger,
  type MCPConfigFile,
  type MCPServerConfig,
  type SDKLogLevel
} from '@ddlqhd/agent-sdk';
import { buildControlAgent, resolveRemoteEnvironmentConfig } from '@ddlqhd/agent-sdk-control';
import type { ModelProvider } from './shared/ws-protocol.js';
import { truncateForLog } from './shared/log-utils.js';
import { describeMissingKey, getOllamaBaseUrl, requireProviderEnv } from './env.js';
import { demoCalculatorTool } from './demo-calculator.js';
import {
  DEFAULT_CLI_AGENT_LOG_LEVEL,
  resolveCliLogFile
} from '../utils/sdk-log.js';

const LOG_PREFIX = '[agent-sdk web]';

const VALID_LOG_LEVELS: SDKLogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

export interface WebRuntimeDefaults {
  cwd: string;
  userBasePath: string;
  mcpConfigPath?: string;
  provider?: ModelProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  includeDemoTools?: boolean;
  logLevel?: SDKLogLevel;
  logFile?: string;
  execServer?: string;
  execToken?: string;
  temperature?: number;
  contextLength?: number;
  thinking?: boolean;
  thinkingLevel?: 'low' | 'medium' | 'high';
  storage?: 'memory' | 'jsonl';
  safeToolsOnly?: boolean;
  memory?: boolean;
  contextManagement?: boolean;
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

let sharedLogger: FileJSONLLogger | null = null;
let sharedLoggerInitialized = false;
let sharedLogLevel: SDKLogLevel = DEFAULT_CLI_AGENT_LOG_LEVEL;
let sharedLogFile: string | null = null;

interface SharedLoggerInfo {
  logger: FileJSONLLogger | null;
  level: SDKLogLevel;
  filePath: string | null;
}

function resolveSharedLogLevel(explicit?: SDKLogLevel): SDKLogLevel {
  if (explicit) return explicit;
  const raw = process.env.AGENT_SDK_LOG_LEVEL?.trim().toLowerCase();
  if (raw && (VALID_LOG_LEVELS as string[]).includes(raw)) {
    return raw as SDKLogLevel;
  }
  return DEFAULT_CLI_AGENT_LOG_LEVEL;
}

/**
 * Initialize the process-wide JSONL logger once at server start (CLI log path convention).
 */
export function initSharedAgentLogger(
  userBasePath: string,
  logFile?: string,
  logLevel?: SDKLogLevel
): SharedLoggerInfo {
  sharedLogLevel = resolveSharedLogLevel(logLevel);
  if (sharedLogLevel === 'silent') {
    sharedLogger = null;
    sharedLoggerInitialized = true;
    sharedLogFile = null;
    return { logger: null, level: sharedLogLevel, filePath: null };
  }
  const filePath = resolveCliLogFile(logFile, userBasePath);
  sharedLogger = createFileJSONLLogger({ filePath });
  sharedLoggerInitialized = true;
  sharedLogFile = sharedLogger.filePath;
  return { logger: sharedLogger, level: sharedLogLevel, filePath: sharedLogFile };
}

export function getSharedAgentLogger(): SharedLoggerInfo {
  if (!sharedLoggerInitialized) {
    return { logger: null, level: sharedLogLevel, filePath: null };
  }
  return {
    logger: sharedLogger,
    level: sharedLogLevel,
    filePath: sharedLogFile
  };
}

/** Flush + close the shared SDK logger. Idempotent and safe to call during shutdown. */
export async function closeSharedAgentLogger(): Promise<void> {
  const current = sharedLogger;
  sharedLogger = null;
  sharedLoggerInitialized = false;
  sharedLogFile = null;
  if (current) {
    await current.close();
  }
}

function resolvePathRelative(p: string | undefined, base: string): string | undefined {
  if (!p || !p.trim()) return undefined;
  const trimmed = p.trim();
  if (isAbsolute(trimmed) || existsSync(trimmed)) return trimmed;
  return resolve(base, trimmed);
}

function resolveApiKey(provider: ModelProvider, defaults: WebRuntimeDefaults): string | undefined {
  if (defaults.apiKey && (!defaults.provider || defaults.provider === provider)) {
    return defaults.apiKey;
  }
  return requireProviderEnv(provider);
}

/**
 * Build an {@link Agent}, wait for init (built-ins / MCP).
 * When `safeToolsOnly`, {@link AgentConfig.disallowedTools} hides `Bash` from the model; any
 * remaining dangerous tools (e.g. from MCP) are unregistered after init.
 */
export async function buildAgent(
  config: BuildAgentOptions,
  defaults: WebRuntimeDefaults
): Promise<{ agent: Agent; warnings: string[] }> {
  const warnings: string[] = [];
  const key = resolveApiKey(config.provider, defaults);
  if (config.provider !== 'ollama' && !key) {
    throw new Error(describeMissingKey(config.provider));
  }

  const cwd =
    resolvePathRelative(config.cwd, defaults.cwd) ?? defaults.cwd;
  const userBasePath =
    resolvePathRelative(config.userBasePath, defaults.userBasePath) ?? defaults.userBasePath;

  const baseUrlApplies = !defaults.provider || defaults.provider === config.provider;
  const cliBaseUrl = baseUrlApplies ? defaults.baseUrl : undefined;

  const modelConfig = {
    provider: config.provider,
    apiKey: key,
    baseUrl: config.provider === 'ollama' ? cliBaseUrl || getOllamaBaseUrl() : cliBaseUrl,
    model: config.model,
    ...(config.thinking !== undefined ? { thinking: config.thinking } : {}),
    ...(config.thinkingLevel !== undefined ? { thinkingLevel: config.thinkingLevel } : {})
  };

  let mcpServers: MCPServerConfig[] | undefined;
  const mcpConfigPath =
    resolvePathRelative(config.mcpConfigPath, cwd) ??
    resolvePathRelative(defaults.mcpConfigPath, cwd);
  if (mcpConfigPath) {
    if (!existsSync(mcpConfigPath)) {
      warnings.push(`MCP config not found: ${mcpConfigPath}`);
    } else {
      try {
        const raw = JSON.parse(readFileSync(mcpConfigPath, 'utf-8')) as MCPConfigFile;
        const errs = validateMCPConfig(raw);
        if (errs.length > 0) {
          warnings.push(`MCP validation: ${errs.join('; ')}`);
        } else {
          const { servers, errors } = loadMCPConfig(mcpConfigPath, cwd, userBasePath);
          for (const err of errors ?? []) {
            warnings.push(err.message);
          }
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

  const agent = await buildControlAgent({
    modelConfig,
    cwd,
    userBasePath,
    storage: { type: config.storage },
    temperature: config.temperature,
    memory: config.memory,
    contextManagement,
    mcpServers,
    includeEnvironment: true,
    askUserQuestion: config.askUserQuestion,
    ...(defaults.includeDemoTools ? { tools: [demoCalculatorTool] } : {}),
    disallowedTools: config.safeToolsOnly ? ['Bash'] : undefined,
    logLevel: sharedLog.level,
    ...(sharedLog.logger ? { logger: sharedLog.logger } : {}),
    environment: resolveRemoteEnvironmentConfig({
      url: defaults.execServer,
      token: defaults.execToken
    }),
    afterInit: (ready) => {
      if (!config.safeToolsOnly) return;
      const reg = ready.getToolRegistry();
      for (const tool of [...reg.getAll()]) {
        if (tool.isDangerous) {
          reg.unregister(tool.name);
        }
      }
    }
  });

  return { agent, warnings };
}
