import { Command } from 'commander';
import { PACKAGE_VERSION } from '../version.js';
import { createChatCommand } from './commands/chat.js';
import { createRunCommand } from './commands/chat.js';
import { createToolsCommand } from './commands/tools.js';
import { createSessionsCommand } from './commands/sessions.js';
import { createMCPCommand } from './commands/mcp.js';

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

  // 添加子命令
  program.addCommand(createChatCommand());
  program.addCommand(createRunCommand());
  program.addCommand(createToolsCommand());
  program.addCommand(createSessionsCommand());
  program.addCommand(createMCPCommand());

  // 解析命令行参数
  program.parse();
}

export { createChatCommand, createRunCommand, createToolsCommand, createSessionsCommand, createMCPCommand };
