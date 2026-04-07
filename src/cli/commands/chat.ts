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
import type { AgentModelConfig, CLIConfig } from '../../core/types.js';
import { loadMCPConfig } from '../../config/index.js';
import { createTtyAskUserQuestionResolver } from '../utils/ask-user-question.js';
import { getLatestSessionId, getSessionStoragePath } from '../../storage/session-path.js';

function parseOllamaThinkCli(value: string | undefined): boolean | 'low' | 'medium' | 'high' {
  if (value === undefined || value === '') return true;
  const s = value.toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  if (s === 'low' || s === 'medium' || s === 'high') return s;
  throw new Error(`Invalid --ollama-think: ${value} (use true, false, low, medium, or high)`);
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
      '--ollama-think [value]',
      'Ollama only: `think` param (true|false|low|medium|high; bare flag => true)',
      (v: string | undefined) => parseOllamaThinkCli(v)
    );
}

function modelConfigFromOptions(options: CLIConfig): AgentModelConfig {
  const provider = (options.model || 'openai') as ModelProvider;
  return {
    provider,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.modelName,
    ...(provider === 'ollama' && options.ollamaThink !== undefined
      ? { think: options.ollamaThink }
      : {})
  };
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
      if (mcpResult.configPath) {
        console.log(chalk.gray(`Loaded MCP config from: ${mcpResult.configPath}`));
        if (mcpResult.servers.length > 0) {
          console.log(chalk.gray(`MCP servers: ${mcpResult.servers.map(s => s.name).join(', ')}`));
        }
      }

      const cwd = options.cwd || process.cwd();
      const agent = new Agent({
        modelConfig: modelConfigFromOptions(options),
        cwd,
        hookConfigDir: cwd,
        systemPrompt: options.system,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        mcpServers: mcpResult.servers,
        userBasePath: options.userBasePath,
        askUserQuestion: process.stdin.isTTY ? createTtyAskUserQuestionResolver() : undefined
      });

      // 等待 Agent 初始化完成（skill 加载、MCP 连接等）
      await agent.waitForInit();
      const model = agent.getModel();

      // 显示已加载的 skills
      const skillRegistry = agent.getSkillRegistry();
      const skills = skillRegistry.getUserInvocableSkills();

      console.log(chalk.cyan('🤖 Agent SDK Chat'));
      console.log(chalk.gray(`Model: ${model.name}`));
      console.log(chalk.gray(`Sessions: ${getSessionStoragePath(options.userBasePath)}`));
      if (skills.length > 0) {
        console.log(chalk.gray(`Skills: ${skills.map(s => `/${s.name}`).join(', ')}`));
      }
      console.log(chalk.gray('Type "exit" or "quit" to end the session'));
      console.log(chalk.gray('Press ESC to interrupt streaming'));
      console.log(chalk.gray('Use /skill-name to invoke a skill\n'));

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
              const result = await agent.run(input, { sessionId });
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

                for await (const event of agent.stream(input, {
                  sessionId,
                  signal: abortController.signal
                })) {
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
        if (mcpResult.configPath) {
          console.log(chalk.gray(`Loaded MCP config from: ${mcpResult.configPath}`));
        }

        const cwd = options.cwd || process.cwd();
        const agent = new Agent({
          modelConfig: modelConfigFromOptions(options),
          cwd,
          hookConfigDir: cwd,
          systemPrompt: options.system,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          mcpServers: mcpResult.servers,
          userBasePath: options.userBasePath,
          askUserQuestion: process.stdin.isTTY ? createTtyAskUserQuestionResolver() : undefined
        });

        // 等待 Agent 初始化完成
        await agent.waitForInit();

        try {
          if (options.output === 'json') {
            const result = await agent.run(prompt, { sessionId });
            console.log(JSON.stringify(result, null, 2));
          } else if (options.stream !== false) {
            const formatter = createStreamFormatter({ verbose: options.verbose });
            for await (const event of agent.stream(prompt, { sessionId })) {
              const output = formatter.format(event);
              if (output) process.stdout.write(output);
            }
            const tail = formatter.finalize();
            if (tail) process.stdout.write(tail);
          } else {
            const result = await agent.run(prompt, { sessionId });
            console.log(result.content);
            if (result.usage) {
              console.log(`\n${formatUsage(result.usage)}`);
            }
          }
        } finally {
          // 清理资源
          await agent.destroy();
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}
