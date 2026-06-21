import { Command } from 'commander';
import chalk from 'chalk';
import type { ModelProvider } from '../../models/index.js';
import { Agent } from '../../core/agent.js';
import type { AgentForkSessionOptions, StreamOptions } from '../../core/agent.js';
import type { AgentModelConfig, MCPInitializationSummary } from '../../core/types.js';
import type { CLIConfig } from '../types.js';
import {
  DEFAULT_CLI_AGENT_LOG_LEVEL,
  describeCliLogLevelOption,
  parseCliLogLevel,
  createCliFileLogger
} from './sdk-log.js';

type CliFileLogger = NonNullable<ReturnType<typeof createCliFileLogger>>;
import { loadMCPConfig, type MCPConfigLoadResult } from '../../config/index.js';
import { createTtyAskUserQuestionResolver } from './ask-user-question.js';
import { getLatestSessionId } from '../../storage/session-path.js';
import { parseAllowedTools, isHeadlessCli } from './print-prompt.js';

function parseThinkingCli(value?: string): boolean {
  if (value === undefined || value === '') return true;
  const s = value.toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  throw new Error(`Invalid --thinking: ${value} (use true or false; bare flag defaults to true)`);
}

function parseThinkingLevelCli(value: string): 'low' | 'medium' | 'high' {
  const s = value.trim().toLowerCase();
  if (s === 'low' || s === 'medium' || s === 'high') return s;
  throw new Error(`Invalid --thinking-level: ${value} (use low, medium, or high)`);
}

export function addHeadlessOptions(cmd: Command): Command {
  return cmd
    .option('-o, --output <format>', 'Output format (text/json)', 'text')
    .option('--output-format <format>', 'Alias for --output (Claude Code compatible)')
    .option(
      '--allowed-tools <tools>',
      'Comma-separated auto-approved tools (maps to AgentConfig.allowedTools)',
      (v: string) => parseAllowedTools(v)
    )
    .option('--bare', 'Skip auto-loading hooks, skills, memory, MCP discovery, and subagent profiles');
}

export function addModelOptions(cmd: Command): Command {
  return cmd
    .option('-m, --model <model>', 'Model to use (openai/anthropic/ollama)', 'openai')
    .option('-k, --api-key <key>', 'API key')
    .option('-u, --base-url <url>', 'Base URL for API')
    .option('-M, --model-name <name>', 'Model name')
    .option('-s, --session <id>', 'Session ID to resume')
    .option('-S, --system <prompt>', 'System prompt')
    .option('-t, --temperature <temp>', 'Temperature', parseFloat)
    .option('--max-tokens <tokens>', 'Max tokens', (v) => parseInt(v, 10))
    .option('--no-stream', 'Disable streaming')
    .option('-v, --verbose', 'Show full tool calls and results')
    .option('--mcp-config <path>', 'Path to MCP config file (mcp_config.json)')
    .option('--user-base-path <path>', 'User base path (default: ~)')
    .option('--cwd <path>', 'Working directory (default: current directory)')
    .option(
      '--resume, --continue',
      'Resume the most recently updated session (uses same storage as --user-base-path; ignored if --session is set)'
    )
    .option(
      '--thinking [value]',
      'Unified model thinking/reasoning (true|false; bare flag => true). Maps to AgentConfig.modelConfig.thinking.',
      (v: string | undefined) => parseThinkingCli(v)
    )
    .option(
      '--thinking-level <level>',
      'Reasoning tier (low|medium|high). Maps to modelConfig.thinkingLevel (Ollama: HTTP think; unused by other adapters).',
      (v: string) => parseThinkingLevelCli(v)
    )
    .option('--log-level <level>', describeCliLogLevelOption(), parseCliLogLevel)
    .option(
      '--log-file <path>',
      'JSONL log file path (default: <userBase>/.claude/logs/agent-sdk-<date>.log; AGENT_SDK_LOG_FILE overrides)'
    )
    .option('--fork', 'Fork session before streaming (requires --session or --resume)')
    .option('--fork-checkpoint-id <id>', 'Fork at checkpoint before streaming')
    .option('--fork-user-turn-index <n>', 'Fork at 0-based user turn before streaming', parseInt);
}

/** Attach JSONL session before slash commands (e.g. chat --resume before first stream). */
export async function ensureChatSessionAttached(agent: Agent, sessionId: string): Promise<void> {
  const sm = agent.getSessionManager();
  if (sm.sessionId === sessionId) {
    return;
  }
  try {
    await sm.attachSession(sessionId);
  } catch {
    sm.createSession(sessionId);
  }
}

export interface CliLogOptions {
  /** Route info-level CLI messages to stderr instead of stdout (headless `-p`). */
  headless?: boolean;
}

function cliInfo(message: string, options?: CliLogOptions): void {
  if (options?.headless) {
    console.error(message);
  } else {
    console.log(message);
  }
}

export async function applyPreStreamFork(
  agent: Agent,
  sessionId: string | undefined,
  options: CLIConfig,
  logOptions?: CliLogOptions
): Promise<string | undefined> {
  const wantsFork =
    options.fork || options.forkCheckpointId !== undefined || options.forkUserTurnIndex !== undefined;
  if (!wantsFork) {
    return sessionId;
  }
  if (!sessionId) {
    throw new Error('--fork / --fork-checkpoint-id / --fork-user-turn-index require --session or --resume');
  }
  const forkOpts: AgentForkSessionOptions = { switchToForked: true };
  if (options.forkCheckpointId) forkOpts.checkpointId = options.forkCheckpointId;
  if (options.forkUserTurnIndex !== undefined) forkOpts.userTurnIndex = options.forkUserTurnIndex;
  const result = await agent.forkSession(sessionId, forkOpts);
  cliInfo(
    chalk.gray(
      `Forked ${result.sourceSessionId} → ${result.sessionId} (${result.messageCount} messages)`
    ),
    logOptions
  );
  return result.sessionId;
}

export function buildStreamOptions(
  sessionId: string | undefined,
  signal?: AbortSignal
): StreamOptions {
  return { sessionId, signal };
}

export function modelConfigFromOptions(options: CLIConfig): AgentModelConfig {
  const provider = (options.model || 'openai') as ModelProvider;
  return {
    provider,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.modelName,
    thinking: options.thinking,
    thinkingLevel: options.thinkingLevel
  };
}

export function reportMCPConfigLoad(result: MCPConfigLoadResult, logOptions?: CliLogOptions): void {
  for (const err of result.errors ?? []) {
    console.warn(chalk.yellow(`MCP config: ${err.message}`));
  }

  if (!result.configPath) {
    return;
  }

  const configPathFailed = result.errors?.some(
    (err) =>
      err.path === result.configPath &&
      (err.kind === 'path_not_found' || err.kind === 'parse_error' || err.serverName === undefined)
  );
  if (configPathFailed) {
    return;
  }

  if (logOptions?.headless) {
    return;
  }

  cliInfo(chalk.gray(`Loaded MCP config from: ${result.configPath}`), logOptions);
  if (result.servers.length > 0) {
    cliInfo(chalk.gray(`MCP servers: ${result.servers.map((s) => s.name).join(', ')}`), logOptions);
  }
}

export function reportMCPInitResult(mcp: MCPInitializationSummary): void {
  if (!mcp.enabled) return;

  for (const err of mcp.configErrors ?? []) {
    console.warn(chalk.yellow(`MCP config: ${err.message}`));
  }

  for (const srv of mcp.servers) {
    if (!srv.connected) {
      if (srv.errorName === 'DuplicateMcpServerName') {
        console.warn(chalk.yellow(`MCP: skipped duplicate server "${srv.name}"`));
      } else {
        console.warn(
          chalk.yellow(
            `MCP: failed to connect "${srv.name}": ${srv.errorMessage ?? srv.errorName ?? 'unknown error'}`
          )
        );
      }
    } else if (srv.toolsRegistered === 0) {
      console.warn(chalk.yellow(`MCP: server "${srv.name}" connected but registered 0 tools`));
    }
  }
}

export interface CliAgentBundle {
  agent: Agent;
  fileLogger: CliFileLogger | null;
  initResult: Awaited<ReturnType<Agent['waitForInit']>>;
  cwd: string;
}

export async function resolveCliSessionId(options: CLIConfig): Promise<string | undefined> {
  let sessionId: string | undefined = options.session;
  if (options.resume && !sessionId) {
    sessionId = await getLatestSessionId(options.userBasePath);
    if (!sessionId) {
      console.warn(chalk.yellow('No saved sessions found; starting a new session.'));
    }
  }
  return sessionId;
}

function loadCliMcpConfig(options: CLIConfig): MCPConfigLoadResult {
  if (options.bare && !options.mcpConfig) {
    return { servers: [] };
  }
  return loadMCPConfig(options.mcpConfig, options.cwd || process.cwd(), options.userBasePath);
}

/** @internal Exported for unit tests. */
export function buildCliAgentConfig(
  options: CLIConfig,
  mcpServers: MCPConfigLoadResult['servers'],
  fileLogger: CliFileLogger | null
) {
  const cwd = options.cwd || process.cwd();
  const effectiveLogLevel = options.logLevel ?? DEFAULT_CLI_AGENT_LOG_LEVEL;

  const bareAgentOptions = options.bare
    ? {
        loadSkills: false as const,
        memory: false as const,
        loadHookSettingsFromFiles: false as const,
        subagent: { enabled: false as const, loadProfilesFromFiles: false as const }
      }
    : {
        hookConfigDir: cwd
      };

  return {
    modelConfig: modelConfigFromOptions(options),
    cwd,
    systemPrompt: options.system,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    mcpServers,
    userBasePath: options.userBasePath,
    logLevel: effectiveLogLevel,
    ...(options.allowedTools ? { allowedTools: options.allowedTools } : {}),
    ...(fileLogger ? { logger: fileLogger } : {}),
    ...bareAgentOptions,
    askUserQuestion: process.stdin.isTTY ? createTtyAskUserQuestionResolver() : undefined
  };
}

export async function createCliAgent(options: CLIConfig): Promise<CliAgentBundle> {
  const headless = isHeadlessCli(options);
  const logOptions: CliLogOptions = { headless: headless || options.bare === true };
  const mcpResult = loadCliMcpConfig(options);
  reportMCPConfigLoad(mcpResult, logOptions);

  const cwd = options.cwd || process.cwd();
  const effectiveLogLevel = options.logLevel ?? DEFAULT_CLI_AGENT_LOG_LEVEL;
  const fileLogger = createCliFileLogger(effectiveLogLevel, options.logFile, options.userBasePath);

  const agent = new Agent(buildCliAgentConfig(options, mcpResult.servers, fileLogger));

  const initResult = await agent.waitForInit();
  reportMCPInitResult(initResult.mcp);

  return { agent, fileLogger, initResult, cwd };
}

export async function destroyCliAgent(agent: Agent, fileLogger: CliFileLogger | null): Promise<void> {
  await agent.destroy();
  if (fileLogger) {
    await fileLogger.close();
  }
}
