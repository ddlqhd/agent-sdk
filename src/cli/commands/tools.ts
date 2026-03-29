import { Command } from 'commander';
import chalk from 'chalk';
import { ToolRegistry } from '../../tools/registry.js';
import { getAllBuiltinTools } from '../../tools/builtin/index.js';
import { createSkillRegistry } from '../../skills/registry.js';
import { formatTable } from '../utils/output.js';

/**
 * 工具管理命令
 */
export function createToolsCommand(): Command {
  const command = new Command('tools')
    .description('Manage agent tools');

  // 列出工具
  command
    .command('list')
    .description('List all available tools')
    .option('-f, --format <format>', 'Output format (table/json)', 'table')
    .option('-c, --category <category>', 'Filter by category')
    .action((options) => {
      const registry = new ToolRegistry();
      const skillRegistry = createSkillRegistry();
      registry.registerMany(getAllBuiltinTools(skillRegistry));

      let tools = registry.getAll();

      if (options.category) {
        tools = tools.filter(t =>
          t.name.startsWith(options.category) ||
          t.description.toLowerCase().includes(options.category.toLowerCase())
        );
      }

      if (options.format === 'json') {
        console.log(JSON.stringify(tools.map(t => ({
          name: t.name,
          description: t.description,
          dangerous: t.isDangerous || false,
          category: t.category || null
        })), null, 2));
      } else {
        console.log(chalk.cyan('\n📦 Available Tools\n'));
        console.log(formatTable(
          tools.map(t => ({
            name: t.name,
            description: t.description.slice(0, 50) + (t.description.length > 50 ? '...' : ''),
            category: t.category || '',
            dangerous: t.isDangerous ? '⚠️' : ''
          })),
          [
            { key: 'name', header: 'Name', width: 20 },
            { key: 'description', header: 'Description', width: 50 },
            { key: 'category', header: 'Category', width: 12 },
            { key: 'dangerous', header: '', width: 3 }
          ]
        ));
        console.log(chalk.gray(`\nTotal: ${tools.length} tools`));
      }
    });

  // 查看工具详情
  command
    .command('show <name>')
    .description('Show tool details')
    .action((name) => {
      const registry = new ToolRegistry();
      const skillRegistry = createSkillRegistry();
      registry.registerMany(getAllBuiltinTools(skillRegistry));

      const tool = registry.get(name);
      if (!tool) {
        console.error(chalk.red(`Tool "${name}" not found`));
        process.exit(1);
      }

      console.log(chalk.cyan(`\n🔧 ${tool.name}\n`));
      console.log(`Description: ${tool.description}`);
      console.log(`Category: ${tool.category || 'none'}`);
      console.log(`Dangerous: ${tool.isDangerous ? 'Yes ⚠️' : 'No'}`);
      console.log(`\nParameters Schema:`);
      console.log(JSON.stringify(tool.parameters, null, 2));
    });

  // 测试工具
  command
    .command('test <name>')
    .description(
      'Test a tool with arguments. Note: AskUserQuestion only prompts when stdin is a TTY; in pipes/CI it returns formatted text without blocking.'
    )
    .option('-a, --args <json>', 'Tool arguments as JSON')
    .action(async (name, options) => {
      const registry = new ToolRegistry();
      const skillRegistry = createSkillRegistry();
      registry.registerMany(getAllBuiltinTools(skillRegistry));

      if (!registry.has(name)) {
        console.error(chalk.red(`Tool "${name}" not found`));
        process.exit(1);
      }

      let args = {};
      if (options.args) {
        try {
          args = JSON.parse(options.args);
        } catch {
          console.error(chalk.red('Invalid JSON in --args'));
          process.exit(1);
        }
      }

      console.log(chalk.cyan(`\n🧪 Testing tool: ${name}\n`));
      console.log(chalk.gray(`Arguments: ${JSON.stringify(args)}\n`));

      const result = await registry.execute(name, args);

      if (result.isError) {
        console.log(chalk.red('❌ Error:'));
        console.log(result.content);
      } else {
        console.log(chalk.green('✅ Result:'));
        console.log(result.content);
      }
    });

  return command;
}
