import { Command } from 'commander';
import chalk from 'chalk';
import { createModel, type ModelProvider } from '../../models/index.js';
import { Agent } from '../../core/agent.js';
import { formatUsage, createStreamFormatter } from '../utils/output.js';
import type { CLIConfig } from '../../core/types.js';
import { loadMCPConfig } from '../../config/index.js';

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
    .option('--mcp-config <path>', 'Path to MCP config file (mcp_config.json)')
    .option('--user-base-path <path>', 'User base path (default: ~)');
}

function createModelFromOptions(options: CLIConfig) {
  return createModel({
    provider: (options.model || 'openai') as ModelProvider,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.modelName
  });
}

/**
 * 交互式对话命令
 */
export function createChatCommand(): Command {
  return addModelOptions(
    new Command('chat').description('Start an interactive chat session')
  ).action(async (options) => {
    try {
      const model = createModelFromOptions(options);

      // 加载 MCP 配置
      const mcpResult = loadMCPConfig(options.mcpConfig, process.cwd(), options.userBasePath);
      if (mcpResult.configPath) {
        console.log(chalk.gray(`Loaded MCP config from: ${mcpResult.configPath}`));
        if (mcpResult.servers.length > 0) {
          console.log(chalk.gray(`MCP servers: ${mcpResult.servers.map(s => s.name).join(', ')}`));
        }
      }

      const agent = new Agent({
        model,
        systemPrompt: options.system,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        mcpServers: mcpResult.servers,
        userBasePath: options.userBasePath
      });

      // 等待 Agent 初始化完成（skill 加载、MCP 连接等）
      await agent.waitForInit();

      // 显示已加载的 skills
      const skillRegistry = agent.getSkillRegistry();
      const skills = skillRegistry.getUserInvocableSkills();

      console.log(chalk.cyan('🤖 Agent SDK Chat'));
      console.log(chalk.gray(`Model: ${model.name}`));
      if (skills.length > 0) {
        console.log(chalk.gray(`Skills: ${skills.map(s => `/${s.name}`).join(', ')}`));
      }
      console.log(chalk.gray('Type "exit" or "quit" to end the session'));
      console.log(chalk.gray('Use /skill-name to invoke a skill\n'));

      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
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

          // 检测 skill 调用并显示反馈
          const processed = await agent.processInput(input);
          if (processed.invoked) {
            console.log(chalk.yellow(`\n⚡ Invoked skill: ${processed.skillName}`));
          }

          process.stdout.write(chalk.blue('\nAssistant: '));

          if (options.stream === false) {
            const result = await agent.run(input, { sessionId: options.session });
            console.log(result.content);
            if (result.usage) {
              console.log(`\n${formatUsage(result.usage)}`);
            }
          } else {
            const formatter = createStreamFormatter();
            for await (const event of agent.stream(input, { sessionId: options.session })) {
              const output = formatter.format(event);
              if (output) process.stdout.write(output);
            }
            const tail = formatter.finalize();
            if (tail) process.stdout.write(tail);
          }

          console.log('\n');
        }
      } finally {
        // 清理资源
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
        const model = createModelFromOptions(options);

        // 加载 MCP 配置
        const mcpResult = loadMCPConfig(options.mcpConfig, process.cwd(), options.userBasePath);
        if (mcpResult.configPath) {
          console.log(chalk.gray(`Loaded MCP config from: ${mcpResult.configPath}`));
        }

        const agent = new Agent({
          model,
          systemPrompt: options.system,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          mcpServers: mcpResult.servers,
          userBasePath: options.userBasePath
        });

        // 等待 Agent 初始化完成
        await agent.waitForInit();

        try {
          if (options.output === 'json') {
            const result = await agent.run(prompt, { sessionId: options.session });
            console.log(JSON.stringify(result, null, 2));
          } else if (options.stream !== false) {
            const formatter = createStreamFormatter();
            for await (const event of agent.stream(prompt, { sessionId: options.session })) {
              const output = formatter.format(event);
              if (output) process.stdout.write(output);
            }
            const tail = formatter.finalize();
            if (tail) process.stdout.write(tail);
          } else {
            const result = await agent.run(prompt, { sessionId: options.session });
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
