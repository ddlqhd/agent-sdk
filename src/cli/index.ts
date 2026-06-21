import { Command } from 'commander';
import { PACKAGE_VERSION } from '../version.js';
import { createChatCommand } from './commands/chat.js';
import { executeSinglePrompt } from './commands/execute-prompt.js';
import { createToolsCommand } from './commands/tools.js';
import { createSessionsCommand } from './commands/sessions.js';
import { createMCPCommand } from './commands/mcp.js';
import { createTuiCommand } from './commands/tui.js';
import { addHeadlessOptions, addModelOptions } from './utils/agent-bootstrap.js';
import { normalizeOutputFormat, resolvePrintPrompt } from './utils/print-prompt.js';

// 动态移除 shebang（tsup 会添加）
const isMainModule = process.argv[1]?.endsWith('cli/index.js') ||
  process.argv[1]?.endsWith('cli\\index.js') ||
  process.argv[1]?.includes('agent-sdk');

if (isMainModule) {
  const program = new Command();

  program
    .name('agent-sdk')
    .description('A TypeScript Agent SDK with multi-model support, MCP integration, and streaming')
    .version(PACKAGE_VERSION);

  addModelOptions(addHeadlessOptions(program)).option(
    '-p, --print [prompt]',
    'Run non-interactively (headless mode)'
  );

  program.action(async (options) => {
    if (options.print === undefined) {
      program.help({ error: true });
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

  // 解析命令行参数
  program.parse();
}

export type { CLIConfig } from './types.js';

export {
  createChatCommand,
  executeSinglePrompt,
  createToolsCommand,
  createSessionsCommand,
  createMCPCommand,
  createTuiCommand
};
