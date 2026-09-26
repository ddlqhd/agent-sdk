import { createCliProgram } from './program.js';
import { applyEnvHttpProxy } from './utils/apply-env-proxy.js';
import { createChatCommand } from './commands/chat.js';
import { executeSinglePrompt } from './commands/execute-prompt.js';
import { createToolsCommand } from './commands/tools.js';
import { createSessionsCommand } from './commands/sessions.js';
import { createMCPCommand } from './commands/mcp.js';
import { createTuiCommand } from './commands/tui.js';
import { createWebCommand } from './commands/web.js';
import { createWorkflowCommand } from './commands/workflow.js';
import { createExecServerCommand } from './commands/exec-server.js';

// 动态移除 shebang（tsup 会添加）
const isMainModule = process.argv[1]?.endsWith('index.js') ||
  process.argv[1]?.endsWith('index.cjs') ||
  process.argv[1]?.includes('agent-sdk');

if (isMainModule) {
  applyEnvHttpProxy();

  // 解析命令行参数
  createCliProgram().parse();
}

export type { CLIConfig } from './types.js';

export { createCliProgram } from './program.js';

export {
  createChatCommand,
  executeSinglePrompt,
  createToolsCommand,
  createSessionsCommand,
  createMCPCommand,
  createTuiCommand,
  createWebCommand,
  createWorkflowCommand,
  createExecServerCommand
};
