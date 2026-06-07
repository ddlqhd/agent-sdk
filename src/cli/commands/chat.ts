import { Command } from 'commander';
import chalk from 'chalk';
import type { ModelProvider } from '../../models/index.js';
import { Agent } from '../../core/agent.js';
import { formatUsage, formatSessionUsage, createStreamFormatter } from '../utils/output.js';
import {
  initKeypressListener,
  setKeypressHandler,
  clearKeypressHandler,
  pauseKeypressListener
} from '../utils/keypress.js';
import type { AgentModelConfig } from '../../core/types.js';
import type { CLIConfig } from '../types.js';
import {
  DEFAULT_CLI_AGENT_LOG_LEVEL,
  describeCliLogLevelOption,
  parseCliLogLevel,
  createCliFileLogger
} from '../utils/sdk-log.js';
import { loadMCPConfig, type MCPConfigLoadResult } from '../../config/index.js';
import { createTtyAskUserQuestionResolver } from '../utils/ask-user-question.js';
import { getLatestSessionId, getSessionStoragePath } from '../../storage/session-path.js';
import { formatTable } from '../utils/output.js';
import type { AgentForkSessionOptions, StreamOptions } from '../../core/agent.js';

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

function addModelOptions(cmd: Command): Command {
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
      '--resume',
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
async function ensureChatSessionAttached(agent: Agent, sessionId: string): Promise<void> {
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

async function applyPreStreamFork(
  agent: Agent,
  sessionId: string | undefined,
  options: CLIConfig
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
  console.log(
    chalk.gray(
      `Forked ${result.sourceSessionId} → ${result.sessionId} (${result.messageCount} messages)`
    )
  );
  return result.sessionId;
}

function buildStreamOptions(
  sessionId: string | undefined,
  signal?: AbortSignal
): StreamOptions {
  return { sessionId, signal };
}

async function handleChatSlashCommand(
  agent: Agent,
  input: string,
  sessionId: string | undefined
): Promise<{ handled: true; sessionId: string | undefined } | { handled: false }> {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return { handled: false };
  }
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0]!.slice(1).toLowerCase();
  const args = parts.slice(1).join(' ').trim();

  if (sessionId) {
    await ensureChatSessionAttached(agent, sessionId);
  }

  if (cmd === 'checkpoints') {
    const checkpoints = await agent.listSessionCheckpoints();
    if (checkpoints.length === 0) {
      console.log(chalk.gray('No checkpoints (attach a session with messages first).'));
    } else {
      console.log(chalk.cyan('\nCheckpoints (userTurnIndex is 0-based):\n'));
      console.log(
        formatTable(
          checkpoints.map((c) => ({
            turn: c.userTurnIndex,
            preview: c.preview,
            summariesAfter: c.summariesAfter ?? 0
          })),
          [
            { key: 'turn', header: 'Turn', width: 6 },
            { key: 'preview', header: 'Preview', width: 50 },
            { key: 'summariesAfter', header: 'Summaries', width: 10 }
          ]
        )
      );
    }
    return { handled: true, sessionId };
  }

  if (cmd === 'rewind') {
    if (!args) {
      console.log(chalk.yellow('Usage: /rewind <userTurnIndex>  (0-based, see /checkpoints)'));
      return { handled: true, sessionId };
    }
    const n = Number.parseInt(args, 10);
    if (!Number.isInteger(n) || n < 0) {
      console.log(chalk.red(`Invalid userTurnIndex: ${args}`));
      return { handled: true, sessionId };
    }
    const result = await agent.rewindToCheckpoint({ userTurnIndex: n });
    console.log(chalk.green(`Rewound: kept ${result.keptMessageCount}, dropped ${result.droppedMessageCount}`));
    console.log(
      chalk.yellow('Terminal output above may be stale; Agent context matches the rewound session.')
    );
    return { handled: true, sessionId };
  }

  if (cmd === 'fork') {
    const result = await agent.forkSession(sessionId, { switchToForked: true });
    console.log(
      chalk.green(`Forked ${result.sourceSessionId} → ${result.sessionId} (${result.messageCount} messages)`)
    );
    console.log(
      chalk.yellow('Terminal output above may be stale; continue in the forked session.')
    );
    return { handled: true, sessionId: result.sessionId };
  }

  return { handled: false };
}

function modelConfigFromOptions(options: CLIConfig): AgentModelConfig {
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

function reportMCPConfigLoad(result: MCPConfigLoadResult): void {
  for (const err of result.errors ?? []) {
    console.warn(chalk.yellow(`MCP config: ${err.message}`));
  }

  if (!result.configPath) {
    return;
  }

  const configPathFailed = result.errors?.some(
    err =>
      err.path === result.configPath &&
      (err.kind === 'path_not_found' || err.kind === 'parse_error' || err.serverName === undefined)
  );
  if (configPathFailed) {
    return;
  }

  console.log(chalk.gray(`Loaded MCP config from: ${result.configPath}`));
  if (result.servers.length > 0) {
    console.log(chalk.gray(`MCP servers: ${result.servers.map(s => s.name).join(', ')}`));
  }
}

function reportMCPInitResult(mcp: import('../../core/types.js').MCPInitializationSummary): void {
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
          chalk.yellow(`MCP: failed to connect "${srv.name}": ${srv.errorMessage ?? srv.errorName ?? 'unknown error'}`)
        );
      }
    } else if (srv.toolsRegistered === 0) {
      console.warn(chalk.yellow(`MCP: server "${srv.name}" connected but registered 0 tools`));
    }
  }
}

/**
 * 交互式对话命令
 */
export function createChatCommand(): Command {
  return addModelOptions(
    new Command('chat').description('Start an interactive chat session')
  ).action(async (options) => {
    try {
      let sessionId: string | undefined = options.session;
      if (options.resume && !sessionId) {
        sessionId = await getLatestSessionId(options.userBasePath);
        if (!sessionId) {
          console.warn(chalk.yellow('No saved sessions found; starting a new session.'));
        }
      }

      // 加载 MCP 配置
      const mcpResult = loadMCPConfig(options.mcpConfig, options.cwd || process.cwd(), options.userBasePath);
      reportMCPConfigLoad(mcpResult);

      const cwd = options.cwd || process.cwd();
      const effectiveLogLevel = options.logLevel ?? DEFAULT_CLI_AGENT_LOG_LEVEL;
      const fileLogger = createCliFileLogger(effectiveLogLevel, options.logFile, options.userBasePath);
      const agent = new Agent({
        modelConfig: modelConfigFromOptions(options),
        cwd,
        hookConfigDir: cwd,
        systemPrompt: options.system,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        mcpServers: mcpResult.servers,
        userBasePath: options.userBasePath,
        logLevel: effectiveLogLevel,
        ...(fileLogger ? { logger: fileLogger } : {}),
        askUserQuestion: process.stdin.isTTY ? createTtyAskUserQuestionResolver() : undefined
      });

      // 等待 Agent 初始化完成（skill 加载、MCP 连接等）
      const initResult = await agent.waitForInit();
      reportMCPInitResult(initResult.mcp);
      const model = agent.getModel();

      // 显示已加载的 skills
      const skillRegistry = agent.getSkillRegistry();
      const skills = skillRegistry.getUserInvocableSkills();

      console.log(chalk.cyan('🤖 Agent SDK Chat'));
      console.log(chalk.gray(`Model: ${model.name}`));
      console.log(chalk.gray(`Sessions: ${getSessionStoragePath(options.userBasePath)}`));
      if (fileLogger) {
        console.log(chalk.gray(`Logs: ${fileLogger.filePath}`));
      }
      if (skills.length > 0) {
        console.log(chalk.gray(`Skills: ${skills.map(s => `/${s.name}`).join(', ')}`));
      }
      console.log(chalk.gray('Type "exit" or "quit" to end the session'));
      console.log(chalk.gray('Press ESC to interrupt streaming'));
      console.log(chalk.gray('Use /skill-name to invoke a skill'));
      console.log(chalk.gray('Session: /checkpoints, /rewind <n>, /fork\n'));

      sessionId = await applyPreStreamFork(agent, sessionId, options);
      if (sessionId) {
        await ensureChatSessionAttached(agent, sessionId);
      }

      const readline = await import('readline');
      // terminal: false avoids readline's raw mode + emitKeypressEvents on stdin. We toggle raw
      // mode ourselves during streaming (ESC interrupt); mixing both causes stuck input after a turn
      // on Windows and other TTYs (see Node internal/readline/interface close() + emitKeypressEvents).
      let rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
      });

      const askQuestion = (): Promise<string> => {
        return new Promise((resolve) => {
          rl.question(chalk.green('You: '), resolve);
        });
      };

      try {
        while (true) {
          const input = await askQuestion();

          if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
            console.log(chalk.gray('\nGoodbye! 👋'));
            break;
          }

          if (!input.trim()) continue;

          const slash = await handleChatSlashCommand(agent, input, sessionId);
          if (slash.handled) {
            sessionId = slash.sessionId;
            continue;
          }

          // Close outer readline for the assistant turn so tools (e.g. AskUserQuestion) can attach
          // their own readline to stdin without duplicate echo. Recreate in finally.
          let releasedOuterReadline = false;
          rl.close();
          releasedOuterReadline = true;
          try {
            // 检测 skill 调用并显示反馈
            const processed = await agent.processInput(input);
            if (processed.invoked) {
              console.log(chalk.yellow(`\n⚡ Invoked skill: ${processed.skillName}`));
            }

            process.stdout.write(chalk.blue('\nAssistant: '));

            if (options.stream === false) {
              const result = await agent.run(input, buildStreamOptions(sessionId));
              console.log(result.content);
              if (result.usage) {
                console.log(`\n${formatUsage(result.usage)}`);
              }
              console.log(`\n${formatSessionUsage(agent.getSessionUsage())}`);
              const sid = agent.getSessionManager().sessionId;
              if (sid) {
                console.log(chalk.gray(`Session id: ${sid} (next time: add --resume or -s ${sid})`));
              }
            } else {
              const abortController = new AbortController();
              let interrupted = false;

              const cleanupKeypress = initKeypressListener();
              setKeypressHandler({
                onAbort: () => {
                  interrupted = true;
                  abortController.abort();
                  process.stdout.write(chalk.yellow('\n[interrupted]\n'));
                }
              });

              let resumeAskStdin: (() => void) | null = null;
              const pendingAskToolCallIds = new Set<string>();

              try {
                const formatter = createStreamFormatter({ verbose: options.verbose });

                for await (const event of agent.stream(
                  input,
                  buildStreamOptions(sessionId, abortController.signal)
                )) {
                  if (interrupted) break;

                  if (event.type === 'tool_call' && event.name === 'AskUserQuestion') {
                    pendingAskToolCallIds.add(event.id);
                    if (!resumeAskStdin) {
                      resumeAskStdin = pauseKeypressListener();
                    }
                  }
                  if (event.type === 'tool_result' && pendingAskToolCallIds.has(event.toolCallId)) {
                    pendingAskToolCallIds.delete(event.toolCallId);
                    if (pendingAskToolCallIds.size === 0 && resumeAskStdin) {
                      resumeAskStdin();
                      resumeAskStdin = null;
                    }
                  }
                  if (event.type === 'tool_error' && pendingAskToolCallIds.has(event.toolCallId)) {
                    pendingAskToolCallIds.delete(event.toolCallId);
                    if (pendingAskToolCallIds.size === 0 && resumeAskStdin) {
                      resumeAskStdin();
                      resumeAskStdin = null;
                    }
                  }

                  const output = formatter.format(event);
                  if (output) process.stdout.write(output);
                }
                if (!interrupted) {
                  const tail = formatter.finalize();
                  if (tail) process.stdout.write(tail);
                  console.log(`\n${formatSessionUsage(agent.getSessionUsage())}`);
                  const sid = agent.getSessionManager().sessionId;
                  if (sid) {
                    console.log(chalk.gray(`Session id: ${sid} (next time: add --resume or -s ${sid})`));
                  }
                }
              } finally {
                if (resumeAskStdin) {
                  resumeAskStdin();
                }
                clearKeypressHandler();
                cleanupKeypress();
              }
            }

            console.log('\n');
          } finally {
            if (releasedOuterReadline) {
              rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                terminal: false
              });
              if (process.stdin.isPaused()) {
                process.stdin.resume();
              }
            }
          }
        }
      } finally {
        await agent.destroy();
        if (fileLogger) {
          await fileLogger.close();
        }
        rl.close();
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
  });
}

/**
 * 单次执行命令
 */
export function createRunCommand(): Command {
  return addModelOptions(
    new Command('run')
      .description('Run a single prompt')
      .argument('<prompt>', 'The prompt to run')
  ).option('-o, --output <format>', 'Output format (text/json)', 'text')
    .action(async (prompt, options) => {
      try {
        let sessionId: string | undefined = options.session;
        if (options.resume && !sessionId) {
          sessionId = await getLatestSessionId(options.userBasePath);
          if (!sessionId) {
            console.warn(chalk.yellow('No saved sessions found; starting a new session.'));
          }
        }

        // 加载 MCP 配置
        const mcpResult = loadMCPConfig(options.mcpConfig, options.cwd || process.cwd(), options.userBasePath);
        reportMCPConfigLoad(mcpResult);

        const cwd = options.cwd || process.cwd();
        const effectiveLogLevel = options.logLevel ?? DEFAULT_CLI_AGENT_LOG_LEVEL;
        const fileLogger = createCliFileLogger(effectiveLogLevel, options.logFile, options.userBasePath);
        const agent = new Agent({
          modelConfig: modelConfigFromOptions(options),
          cwd,
          hookConfigDir: cwd,
          systemPrompt: options.system,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          mcpServers: mcpResult.servers,
          userBasePath: options.userBasePath,
          logLevel: effectiveLogLevel,
          ...(fileLogger ? { logger: fileLogger } : {}),
          askUserQuestion: process.stdin.isTTY ? createTtyAskUserQuestionResolver() : undefined
        });

        // 等待 Agent 初始化完成
        const initResult = await agent.waitForInit();
        reportMCPInitResult(initResult.mcp);

        sessionId = await applyPreStreamFork(agent, sessionId, options);

        try {
          if (options.output === 'json') {
            const result = await agent.run(prompt, buildStreamOptions(sessionId));
            console.log(JSON.stringify(result, null, 2));
          } else if (options.stream !== false) {
            const formatter = createStreamFormatter({ verbose: options.verbose });
            for await (const event of agent.stream(prompt, buildStreamOptions(sessionId))) {
              const output = formatter.format(event);
              if (output) process.stdout.write(output);
            }
            const tail = formatter.finalize();
            if (tail) process.stdout.write(tail);
          } else {
            const result = await agent.run(prompt, buildStreamOptions(sessionId));
            console.log(result.content);
            if (result.usage) {
              console.log(`\n${formatUsage(result.usage)}`);
            }
          }
        } finally {
          // 清理资源
          await agent.destroy();
          if (fileLogger) {
            await fileLogger.close();
          }
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}
