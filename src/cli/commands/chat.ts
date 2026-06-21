import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { Agent } from '../../core/agent.js';
import { formatUsage, formatSessionUsage, createStreamFormatter } from '../utils/output.js';
import {
  initKeypressListener,
  setKeypressHandler,
  clearKeypressHandler,
  pauseKeypressListener
} from '../utils/keypress.js';
import type { CLIConfig } from '../types.js';
import { getSessionStoragePath } from '../../storage/session-path.js';
import {
  addModelOptions,
  applyPreStreamFork,
  buildStreamOptions,
  createCliAgent,
  destroyCliAgent,
  ensureChatSessionAttached,
  resolveCliSessionId
} from '../utils/agent-bootstrap.js';
import { replayAgentHistory } from '../utils/chat-history.js';
import { handleSlashCommand, suggestSlashCommands, type SlashContext } from '../utils/slash-commands.js';

let shellPrefixWarned = false;

function processShellPrefix(input: string, cwd: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('!')) return null;
  if (!process.stdin.isTTY) {
    console.log(chalk.red('! shell commands require a TTY.'));
    return '';
  }
  if (!shellPrefixWarned) {
    console.log(chalk.yellow('Warning: ! runs shell commands in the agent cwd. Use with care.'));
    shellPrefixWarned = true;
  }
  const cmd = trimmed.slice(1).trim();
  if (!cmd) return '';
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf-8', maxBuffer: 1024 * 512 });
    return `[shell: ${cmd}]\n${out}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[shell failed: ${cmd}]\n${msg}`;
  }
}

function formatPrompt(sessionId: string | undefined): string {
  if (sessionId) {
    const short = sessionId.length > 8 ? `${sessionId.slice(0, 8)}…` : sessionId;
    return chalk.green(`You [${short}]: `);
  }
  return chalk.green('You: ');
}

function printChatBanner(
  agent: Agent,
  options: CLIConfig,
  cwd: string,
  fileLogger: { filePath: string } | null,
  sessionId: string | undefined
): void {
  const model = agent.getModel();
  const skillRegistry = agent.getSkillRegistry();
  const skills = skillRegistry.getUserInvocableSkills();
  const toolCount = agent.getToolRegistry().getAll().length;

  console.log(chalk.cyan('🤖 Agent SDK Chat'));
  console.log(chalk.gray(`Model: ${model.name}`));
  console.log(chalk.gray(`CWD: ${cwd}`));
  console.log(chalk.gray(`Tools: ${toolCount}`));
  console.log(chalk.gray(`Sessions: ${getSessionStoragePath(options.userBasePath)}`));
  if (sessionId) {
    console.log(chalk.gray(`Session: ${sessionId}`));
  }
  if (fileLogger) {
    console.log(chalk.gray(`Logs: ${fileLogger.filePath}`));
  }
  if (skills.length > 0) {
    console.log(chalk.gray(`Skills: ${skills.map((s) => `/${s.name}`).join(', ')}`));
  }
  console.log(chalk.gray('Type exit, /exit, or /help'));
  console.log(chalk.gray('Press ESC to interrupt streaming\n'));
}

async function runAssistantTurn(
  agent: Agent,
  input: string,
  sessionId: string | undefined,
  stream: boolean,
  verbose: boolean
): Promise<void> {
  const processed = await agent.processInput(input);
  if (processed.invoked) {
    console.log(chalk.yellow(`\n⚡ Invoked skill: ${processed.skillName}`));
  }

  process.stdout.write(chalk.blue('\nAssistant: '));

  if (!stream) {
    const result = await agent.run(input, buildStreamOptions(sessionId));
    console.log(result.content);
    if (result.usage) {
      console.log(`\n${formatUsage(result.usage)}`);
    }
    console.log(`\n${formatSessionUsage(agent.getSessionUsage())}`);
    const sid = agent.getSessionManager().sessionId;
    if (sid) {
      console.log(chalk.gray(`Session id: ${sid} (next time: --resume or -s ${sid})`));
    }
    return;
  }

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
    const formatter = createStreamFormatter({ verbose });
    for await (const event of agent.stream(input, buildStreamOptions(sessionId, abortController.signal))) {
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
        console.log(chalk.gray(`Session id: ${sid} (next time: --resume or -s ${sid})`));
      }
    }
  } finally {
    if (resumeAskStdin) resumeAskStdin();
    clearKeypressHandler();
    cleanupKeypress();
  }
}

/**
 * 交互式对话命令
 */
export function createChatCommand(): Command {
  return addModelOptions(
    new Command('chat').description('Start an interactive chat session')
  ).action(async (options: CLIConfig) => {
    try {
      let sessionId = await resolveCliSessionId(options);
      const { agent, fileLogger, cwd } = await createCliAgent(options);

      printChatBanner(agent, options, cwd, fileLogger, sessionId);

      sessionId = await applyPreStreamFork(agent, sessionId, options);
      if (sessionId) {
        await ensureChatSessionAttached(agent, sessionId);
        if (agent.getSessionManager().sessionId) {
          const count = (await agent.getSessionManager().loadActiveMessages()).length;
          if (count > 0) {
            await replayAgentHistory(agent, { verbose: options.verbose === true });
          }
        }
      }

      let verbose = options.verbose === true;
      const readline = await import('readline');
      let rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
      });

      const askQuestion = (): Promise<string> =>
        new Promise((resolve) => {
          rl.question(formatPrompt(sessionId), resolve);
        });

      const slashCtxBase = (): Omit<SlashContext, 'askLine' | 'verbose' | 'sessionId'> => ({
        userBasePath: options.userBasePath,
        cwd,
        onReplay: async (opts) => {
          await replayAgentHistory(agent, { verbose: opts?.verbose ?? verbose });
        }
      });

      try {
        while (true) {
          let input = await askQuestion();

          if (
            input.toLowerCase() === 'exit' ||
            input.toLowerCase() === 'quit'
          ) {
            console.log(chalk.gray('\nGoodbye! 👋'));
            break;
          }

          if (!input.trim()) continue;

          if (input.trim().startsWith('/') && !input.trim().includes('\n')) {
            suggestSlashCommands(input);
          }

          const slashCtx: SlashContext = {
            ...slashCtxBase(),
            sessionId,
            verbose,
            askLine: (prompt) =>
              new Promise((resolve) => {
                rl.question(prompt, resolve);
              })
          };

          const slash = await handleSlashCommand(agent, input, slashCtx);
          if (slash.handled) {
            if (slash.exit) {
              console.log(chalk.gray('\nGoodbye! 👋'));
              break;
            }
            if (slash.sessionId !== undefined) sessionId = slash.sessionId;
            if (slash.verbose !== undefined) verbose = slash.verbose;
            if (slash.replayHistory) {
              await slashCtx.onReplay({ verbose });
            }
            if (slash.pendingUserInput) {
              input = slash.pendingUserInput;
            } else {
              continue;
            }
          } else if (input.trim().startsWith('/')) {
            const cmdPart = input.trim().slice(1).split(/\s+/)[0] ?? '';
            const skillTry = await agent.processInput(input);
            if (!skillTry.invoked) {
              console.log(chalk.yellow(`Unknown command /${cmdPart}. Type /help for commands.`));
              continue;
            }
          }

          const shellOut = processShellPrefix(input, cwd);
          if (shellOut !== null) {
            if (!shellOut) continue;
            input = shellOut;
          }

          let releasedOuterReadline = false;
          rl.close();
          releasedOuterReadline = true;
          try {
            await runAssistantTurn(agent, input, sessionId, options.stream !== false, verbose);
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
        await destroyCliAgent(agent, fileLogger);
        rl.close();
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
  });
}
