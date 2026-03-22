import { Command } from 'commander';
import chalk from 'chalk';
import { createOpenAI } from '../../models/openai.js';
import { createAnthropic } from '../../models/anthropic.js';
import { createOllama } from '../../models/ollama.js';
import { Agent } from '../../core/agent.js';
import { formatUsage, truncate } from '../utils/output.js';
import type { ModelAdapter, CLIConfig, TokenUsage } from '../../core/types.js';

/**
 * 交互式对话命令
 */
export function createChatCommand(): Command {
  return new Command('chat')
    .description('Start an interactive chat session')
    .option('-m, --model <model>', 'Model to use (openai/anthropic/ollama)', 'openai')
    .option('-k, --api-key <key>', 'API key')
    .option('-u, --base-url <url>', 'Base URL for API')
    .option('-M, --model-name <name>', 'Model name')
    .option('-s, --session <id>', 'Session ID to resume')
    .option('-S, --system <prompt>', 'System prompt')
    .option('-t, --temperature <temp>', 'Temperature', parseFloat)
    .option('--max-tokens <tokens>', 'Max tokens', parseInt)
    .option('--no-stream', 'Disable streaming')
    .action(async (options) => {
      try {
        const model = createModelFromOptions(options);
        const agent = new Agent({
          model,
          systemPrompt: options.system,
          temperature: options.temperature,
          maxTokens: options.maxTokens
        });

        console.log(chalk.cyan('🤖 Agent SDK Chat'));
        console.log(chalk.gray(`Model: ${model.name}`));
        console.log(chalk.gray('Type "exit" or "quit" to end the session\n'));

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

        while (true) {
          const input = await askQuestion();

          if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
            console.log(chalk.gray('\nGoodbye! 👋'));
            rl.close();
            break;
          }

          if (!input.trim()) continue;

          process.stdout.write(chalk.blue('\nAssistant: '));

          let fullResponse = '';
          let isFirstThinking = true;
          let lastEventType: string | null = null;
          const toolCalls = new Map<string, { name: string; arguments: unknown }>();

          for await (const event of agent.stream(input, {
            sessionId: options.session
          })) {
            // 检测thinking块结束
            if (lastEventType === 'thinking' && event.type !== 'thinking') {
              process.stdout.write('\n');
              isFirstThinking = true; // 重置，为下一个thinking块准备
            }

            if (event.type === 'text_delta') {
              process.stdout.write(event.content);
              fullResponse += event.content;
            } else if (event.type === 'thinking') {
              if (isFirstThinking) {
                process.stdout.write(chalk.gray(`💭 ${event.content}`));
                isFirstThinking = false;
              } else {
                process.stdout.write(chalk.gray(event.content));
              }
            } else if (event.type === 'tool_call_start') {
              toolCalls.set(event.id, { name: event.name, arguments: undefined });
            } else if (event.type === 'tool_call') {
              toolCalls.set(event.id, { name: event.name, arguments: event.arguments });
            } else if (event.type === 'tool_result') {
              const tc = toolCalls.get(event.toolCallId);
              const name = tc?.name ?? 'tool';
              const argsStr = tc?.arguments ? `(${truncate(JSON.stringify(tc.arguments), 80)})` : '()';
              const resultStr = truncate(event.result, 120);
              process.stdout.write(chalk.yellow(`\n🔧 ${name}`) + chalk.gray(argsStr) + chalk.green(` ✓ ${resultStr}`));
            } else if (event.type === 'tool_error') {
              const tc = toolCalls.get(event.toolCallId);
              const name = tc?.name ?? 'tool';
              const argsStr = tc?.arguments ? `(${truncate(JSON.stringify(tc.arguments), 80)})` : '()';
              process.stdout.write(chalk.yellow(`\n🔧 ${name}`) + chalk.gray(argsStr) + chalk.red(` ✗ ${event.error.message}`));
            } else if (event.type === 'metadata' && event.data?.usage) {
              process.stdout.write(`\n${formatUsage(event.data.usage as TokenUsage)}\n`);
            } else if (event.type === 'error') {
              process.stdout.write(chalk.red(`\n✗ ${event.error.message}`));
            }

            lastEventType = event.type;
          }
          
          // 循环结束后，如果最后一个事件是thinking，需要换行
          if (lastEventType === 'thinking') {
            process.stdout.write('\n');
          }

          console.log('\n');
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
  return new Command('run')
    .description('Run a single prompt')
    .argument('<prompt>', 'The prompt to run')
    .option('-m, --model <model>', 'Model to use (openai/anthropic/ollama)', 'openai')
    .option('-k, --api-key <key>', 'API key')
    .option('-u, --base-url <url>', 'Base URL for API')
    .option('-M, --model-name <name>', 'Model name')
    .option('-s, --session <id>', 'Session ID')
    .option('-S, --system <prompt>', 'System prompt')
    .option('-t, --temperature <temp>', 'Temperature', parseFloat)
    .option('--max-tokens <tokens>', 'Max tokens', parseInt)
    .option('--no-stream', 'Disable streaming')
    .option('-o, --output <format>', 'Output format (text/json)', 'text')
    .action(async (prompt, options) => {
      try {
        const model = createModelFromOptions(options);
        const agent = new Agent({
          model,
          systemPrompt: options.system,
          temperature: options.temperature,
          maxTokens: options.maxTokens
        });

        if (options.output === 'json') {
          const result = await agent.run(prompt, { sessionId: options.session });
          console.log(JSON.stringify(result, null, 2));
        } else if (options.stream !== false) {
          let isFirstThinking = true;
          let lastEventType: string | null = null;
          const toolCalls = new Map<string, { name: string; arguments: unknown }>();

          for await (const event of agent.stream(prompt, { sessionId: options.session })) {
            // 检测thinking块结束
            if (lastEventType === 'thinking' && event.type !== 'thinking') {
              process.stdout.write('\n');
              isFirstThinking = true; // 重置，为下一个thinking块准备
            }

            if (event.type === 'text_delta') {
              process.stdout.write(event.content);
            } else if (event.type === 'thinking') {
              if (isFirstThinking) {
                process.stdout.write(chalk.gray(`💭 ${event.content}`));
                isFirstThinking = false;
              } else {
                process.stdout.write(chalk.gray(event.content));
              }
            } else if (event.type === 'tool_call_start') {
              toolCalls.set(event.id, { name: event.name, arguments: undefined });
            } else if (event.type === 'tool_call') {
              toolCalls.set(event.id, { name: event.name, arguments: event.arguments });
            } else if (event.type === 'tool_result') {
              const tc = toolCalls.get(event.toolCallId);
              const name = tc?.name ?? 'tool';
              const argsStr = tc?.arguments ? `(${truncate(JSON.stringify(tc.arguments), 80)})` : '()';
              const resultStr = truncate(event.result, 120);
              process.stdout.write(chalk.yellow(`\n🔧 ${name}`) + chalk.gray(argsStr) + chalk.green(` ✓ ${resultStr}`));
            } else if (event.type === 'tool_error') {
              const tc = toolCalls.get(event.toolCallId);
              const name = tc?.name ?? 'tool';
              const argsStr = tc?.arguments ? `(${truncate(JSON.stringify(tc.arguments), 80)})` : '()';
              process.stdout.write(chalk.yellow(`\n🔧 ${name}`) + chalk.gray(argsStr) + chalk.red(` ✗ ${event.error.message}`));
            } else if (event.type === 'metadata' && event.data?.usage) {
              console.log(`\n${formatUsage(event.data.usage as TokenUsage)}`);
            } else if (event.type === 'error') {
              console.error(chalk.red(`\nError: ${event.error.message}`));
            }

            lastEventType = event.type;
          }
          
          // 循环结束后，如果最后一个事件是thinking，需要换行
          if (lastEventType === 'thinking') {
            process.stdout.write('\n');
          }
        } else {
          const result = await agent.run(prompt, { sessionId: options.session });
          console.log(result.content);
          if (result.usage) {
            console.log(`\n${formatUsage(result.usage)}`);
          }
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

/**
 * 从命令行选项创建模型适配器
 */
function createModelFromOptions(options: CLIConfig): ModelAdapter {
  const provider = options.model || 'openai';
  const apiKey = options.apiKey;
  const baseUrl = options.baseUrl;
  const modelName = options.modelName;

  switch (provider) {
    case 'openai':
      return createOpenAI({
        apiKey,
        baseUrl,
        model: modelName
      });

    case 'anthropic':
      return createAnthropic({
        apiKey,
        baseUrl,
        model: modelName
      });

    case 'ollama':
      return createOllama({
        baseUrl: baseUrl || 'http://localhost:11434',
        model: modelName || 'llama3'
      });

    default:
      throw new Error(`Unknown model provider: ${provider}`);
  }
}
