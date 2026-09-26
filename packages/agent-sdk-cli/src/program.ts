import { Command } from 'commander';
import { PACKAGE_VERSION } from './version.js';
import { createChatCommand } from './commands/chat.js';
import { executeSinglePrompt } from './commands/execute-prompt.js';
import { createToolsCommand } from './commands/tools.js';
import { createSessionsCommand } from './commands/sessions.js';
import { createMCPCommand } from './commands/mcp.js';
import { createTuiCommand } from './commands/tui.js';
import { createWebCommand } from './commands/web.js';
import { createWorkflowCommand } from './commands/workflow.js';
import { createExecServerCommand } from './commands/exec-server.js';
import { addHeadlessOptions, addModelOptions } from './utils/agent-bootstrap.js';
import { normalizeOutputFormat, resolvePrintPrompt } from './utils/print-prompt.js';

/**
 * 构建完整的 CLI program（无副作用，便于单测真实的参数解析路径）。
 *
 * 直接执行 CLI 时由 `index.ts` 调用并 `parse()`。
 */
export function createCliProgram(): Command {
  const program = new Command();

  program
    .name('agent-sdk')
    .description('A TypeScript Agent SDK with multi-model support, MCP integration, and streaming')
    .version(PACKAGE_VERSION);

  // commander 默认会从根命令开始解析整条 argv：根命令与子命令同名的 flag（`--model` /
  // `--cwd` / `--user-base-path` …）会被根命令吃掉，子命令拿到的永远是默认值
  // （例：`chat --cwd /tmp`、`sessions list --user-base-path <dir>` 均被静默忽略）。
  // positional options 让本命令在遇到子命令名后停止解析，把剩余参数转发给子命令。
  // 有子命令的中间层（sessions / tools / mcp / workflow）也要打开，否则
  // `sessions list -f json` 里的 `-f` 会被 `sessions` 当成未知参数。
  program.enablePositionalOptions();

  addModelOptions(addHeadlessOptions(program)).option(
    '-p, --print [prompt]',
    'Run non-interactively (headless mode)'
  );

  // 写在子命令**之前**的共享 flag（`agent-sdk --cwd /tmp chat`）由根命令解析，
  // 这里补转发给真正执行的子命令，避免同一个 flag 换个位置就被静默忽略。
  // 子命令自身位置上的值（`cli`）优先，已有的默认值可被根命令的 CLI 值覆盖。
  program.hook('preAction', (hookedCommand, actionCommand) => {
    for (const option of hookedCommand.options) {
      const key = option.attributeName();
      if (hookedCommand.getOptionValueSource(key) !== 'cli') continue;
      const target = actionCommand.getOptionValueSource(key);
      if (target === undefined || target === 'default') {
        actionCommand.setOptionValue(key, hookedCommand.getOptionValue(key));
      }
    }
  });

  program.action(async (options) => {
    if (options.print === undefined) {
      const chatCmd = program.commands.find((c) => c.name() === 'chat');
      if (!chatCmd) {
        program.help();
        return;
      }
      await chatCmd.parseAsync(
        [process.argv[0]!, process.argv[1]!, 'chat', ...process.argv.slice(2)],
        { from: 'user' }
      );
      return;
    }
    try {
      const prompt = await resolvePrintPrompt(options.print);
      const normalized = normalizeOutputFormat({ ...options, print: options.print });
      await executeSinglePrompt(prompt, normalized);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

  // 添加子命令
  program.addCommand(createChatCommand());
  program.addCommand(createToolsCommand());
  program.addCommand(createSessionsCommand());
  program.addCommand(createMCPCommand());
  program.addCommand(createTuiCommand());
  program.addCommand(createWebCommand());
  program.addCommand(createWorkflowCommand());
  program.addCommand(createExecServerCommand());

  return program;
}
