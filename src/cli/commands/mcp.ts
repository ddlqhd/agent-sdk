import { Command } from 'commander';
import chalk from 'chalk';
import { MCPAdapter } from '../../mcp/adapter.js';
import type { MCPServerConfig } from '../../core/types.js';

export function createMCPCommand(): Command {
  const command = new Command('mcp')
    .description('Manage MCP servers');

  command
    .command('connect <command>')
    .description('Connect to an MCP server and list available tools')
    .option('-n, --name <name>', 'Server name', 'default')
    .option('-a, --args <args>', 'Command arguments (comma-separated)')
    .option('-e, --env <env>', 'Environment variables (KEY=VALUE,comma-separated)')
    .action(async (cmd, options) => {
      try {
        const adapter = new MCPAdapter();

        const args = options.args ? options.args.split(',') : [];
        const env: Record<string, string> = {};
        if (options.env) {
          for (const pair of options.env.split(',')) {
            const [key, value] = pair.split('=');
            if (key && value) {
              env[key] = value;
            }
          }
        }

        console.log(chalk.cyan(`\n🔌 Connecting to MCP server: ${options.name}\n`));

        const config: MCPServerConfig = {
          name: options.name,
          transport: 'stdio',
          command: cmd,
          args,
          env: Object.keys(env).length > 0 ? env : undefined
        };

        await adapter.addServer(config);

        console.log(chalk.green('✓ Connected successfully'));

        const tools = await adapter.listAllTools();
        const serverTools = tools.get(options.name) || [];

        if (serverTools.length > 0) {
          console.log(chalk.cyan('\n📦 Available tools:\n'));
          for (const tool of serverTools) {
            console.log(`  • ${tool.name}: ${tool.description || 'No description'}`);
          }
        } else {
          console.log(chalk.gray('\nNo tools available'));
        }

        await adapter.disconnectAll();
      } catch (err) {
        console.error(chalk.red(`Connection failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  return command;
}