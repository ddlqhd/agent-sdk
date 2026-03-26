import chalk from 'chalk';
import type { StreamEvent, TokenUsage, SessionTokenUsage } from '../../core/types.js';

/**
 * 输出格式化配置
 */
export interface OutputConfig {
  color?: boolean;
  verbose?: boolean;
}

/**
 * 格式化流式事件输出
 */
export function formatEvent(event: StreamEvent, config: OutputConfig = {}): string {
  const { color = true, verbose = false } = config;

  switch (event.type) {
    case 'start':
      return color ? chalk.gray('▶ Starting...') : '▶ Starting...';

    case 'text_delta':
      return event.content;

    case 'text_start':
      return '';

    case 'text_end':
      return '\n';

    case 'tool_call_start':
      return color
        ? chalk.yellow(`\n🔧 Calling tool: ${event.name}`)
        : `\n🔧 Calling tool: ${event.name}`;

    case 'tool_call':
      return color
        ? chalk.yellow(`\n🔧 Tool: ${event.name}(${JSON.stringify(event.arguments)})`)
        : `\n🔧 Tool: ${event.name}(${JSON.stringify(event.arguments)})`;

    case 'tool_result':
      return color
        ? chalk.green(`✓ Result: ${truncate(event.result, 100)}`)
        : `✓ Result: ${truncate(event.result, 100)}`;

    case 'tool_error':
      return color
        ? chalk.red(`✗ Tool error: ${event.error.message}`)
        : `✗ Tool error: ${event.error.message}`;

    case 'thinking':
      return color
        ? chalk.gray(`💭 ${event.content}`)
        : `💭 ${event.content}`;

    case 'error':
      return color
        ? chalk.red(`\n✗ Error: ${event.error.message}`)
        : `\n✗ Error: ${event.error.message}`;

    case 'metadata':
      if (verbose && event.data) {
        return color
          ? chalk.gray(`\n📊 ${JSON.stringify(event.data, null, 2)}`)
          : `\n📊 ${JSON.stringify(event.data, null, 2)}`;
      }
      return '';

    case 'end':
      return '';

    default:
      return '';
  }
}

/**
 * 有状态的流式事件格式化器
 */
export interface StreamFormatter {
  format(event: StreamEvent): string;
  finalize(): string;
}

export function createStreamFormatter(): StreamFormatter {
  let lastEventType: string | null = null;
  let isFirstThinking = true;
  const toolCalls = new Map<string, { name: string; arguments: unknown }>();

  return {
    format(event: StreamEvent): string {
      let output = '';

      // thinking 块结束时插入换行
      if (lastEventType === 'thinking' && event.type !== 'thinking') {
        output += '\n';
        isFirstThinking = true;
      }

      switch (event.type) {
        case 'text_delta':
          output += event.content;
          break;

        case 'thinking':
          if (isFirstThinking) {
            output += `\n${chalk.gray(`💭 ${event.content}`)}`;
            isFirstThinking = false;
          } else {
            output += chalk.gray(event.content);
          }
          break;

        case 'tool_call_start':
          toolCalls.set(event.id, { name: event.name, arguments: undefined });
          break;

        case 'tool_call':
          toolCalls.set(event.id, { name: event.name, arguments: event.arguments });
          break;

        case 'tool_result': {
          const tc = toolCalls.get(event.toolCallId);
          const name = tc?.name ?? 'tool';
          const argsStr = tc?.arguments ? `(${truncate(JSON.stringify(tc.arguments), 80)})` : '()';
          const resultStr = truncate(event.result, 120);
          output += chalk.yellow(`\n🔧 ${name}`) + chalk.gray(argsStr) + chalk.green(` ✓ ${resultStr}`);
          break;
        }

        case 'tool_error': {
          const tc = toolCalls.get(event.toolCallId);
          const name = tc?.name ?? 'tool';
          const argsStr = tc?.arguments ? `(${truncate(JSON.stringify(tc.arguments), 80)})` : '()';
          output += chalk.yellow(`\n🔧 ${name}`) + chalk.gray(argsStr) + chalk.red(` ✗ ${event.error.message}`);
          break;
        }

        case 'metadata':
          if (event.data?.usage) {
            output += `\n${formatUsage(event.data.usage as TokenUsage)}`;
          }
          break;

        case 'error':
          output += chalk.red(`\n✗ ${event.error.message}`);
          break;
      }

      lastEventType = event.type;
      return output;
    },

    finalize(): string {
      return lastEventType === 'thinking' ? '\n' : '';
    }
  };
}

/**
 * 格式化 Token 使用统计
 */
export function formatUsage(usage: TokenUsage, config: OutputConfig = {}): string {
  const { color = true } = config;

  const text = `📊 Tokens: ${usage.promptTokens} in, ${usage.completionTokens} out (${usage.totalTokens} total)`;

  return color ? chalk.gray(text) : text;
}

/**
 * 格式化会话 Token 使用统计
 *
 * 区分：
 * - Context: 当前上下文大小 (用于压缩判断)
 * - Input: 累计输入消耗
 * - Output: 累计输出消耗
 * - Total: 累计总消耗 (Input + Output)
 */
export function formatSessionUsage(usage: SessionTokenUsage, config: OutputConfig = {}): string {
  const { color = true } = config;

  let text = `📊 Input: ${usage.inputTokens} | Output: ${usage.outputTokens} | Total: ${usage.totalTokens}`;
  if (usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0) {
    text += ` | Cache: ${usage.cacheReadTokens}r/${usage.cacheWriteTokens}w`;
  }

  return color ? chalk.gray(text) : text;
}

/**
 * 格式化表格
 */
export function formatTable(
  data: Record<string, unknown>[],
  columns: Array<{ key: string; header: string; width?: number }>
): string {
  if (data.length === 0) {
    return 'No data';
  }

  // 计算列宽
  const widths = columns.map(col => {
    const headerLen = col.header.length;
    const maxDataLen = Math.max(
      ...data.map(row => String(row[col.key] || '').length)
    );
    return col.width || Math.max(headerLen, maxDataLen, 10);
  });

  // 生成表头
  const header = columns.map((col, i) => col.header.padEnd(widths[i])).join(' │ ');
  const separator = widths.map(w => '─'.repeat(w)).join('─┼─');

  // 生成数据行
  const rows = data.map(row =>
    columns.map((col, i) => String(row[col.key] || '').padEnd(widths[i])).join(' │ ')
  );

  return [header, separator, ...rows].join('\n');
}

/**
 * 截断字符串
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * 打印成功消息
 */
export function success(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

/**
 * 打印错误消息
 */
export function error(message: string): void {
  console.error(chalk.red(`✗ ${message}`));
}

/**
 * 打印警告消息
 */
export function warn(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}

/**
 * 打印信息消息
 */
export function info(message: string): void {
  console.log(chalk.blue(`ℹ ${message}`));
}

/**
 * 创建进度指示器
 */
export function createSpinner(text: string): {
  start: () => void;
  stop: (finalText?: string) => void;
  update: (text: string) => void;
} {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  let interval: NodeJS.Timeout | null = null;
  let currentText = text;

  return {
    start() {
      process.stdout.write('\x1B[?25l'); // 隐藏光标
      interval = setInterval(() => {
        process.stdout.write(`\r${chalk.cyan(frames[frameIndex])} ${currentText}`);
        frameIndex = (frameIndex + 1) % frames.length;
      }, 80);
    },

    stop(finalText?: string) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      process.stdout.write('\r\x1B[K'); // 清除行
      process.stdout.write('\x1B[?25h'); // 显示光标
      if (finalText) {
        console.log(finalText);
      }
    },

    update(text: string) {
      currentText = text;
    }
  };
}

/**
 * 读取用户输入
 */
export async function prompt(question: string): Promise<string> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * 确认提示
 */
export async function confirm(question: string): Promise<boolean> {
  const answer = await prompt(`${question} (y/N) `);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}
