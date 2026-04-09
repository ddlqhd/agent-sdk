import chalk from 'chalk';
import type { StreamEvent, TokenUsage, SessionTokenUsage } from '../../core/types.js';

/**
 * 输出格式化配置
 */
export interface OutputConfig {
  color?: boolean;
  verbose?: boolean;
}

/** CLI line when a stream ends after hitting `AgentConfig.maxIterations`. */
export const STREAM_END_MAX_ITERATIONS_MESSAGE =
  '\n[stopped: reached maxIterations — increase AgentConfig.maxIterations if the task needs more tool rounds]';

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
        ? chalk.green(`\n✓ Result: ${truncate(event.result, 100)}`)
        : `\n✓ Result: ${truncate(event.result, 100)}`;

    case 'tool_error':
      return color
        ? chalk.red(`\n✗ Tool error: ${event.error.message}`)
        : `\n✗ Tool error: ${event.error.message}`;

    case 'thinking':
      return color
        ? chalk.gray(`💭 ${event.content}`)
        : `💭 ${event.content}`;

    case 'thinking_start':
    case 'thinking_end':
      return '';

    case 'model_usage':
      if (verbose) {
        const phase = event.phase ? ` (${event.phase})` : '';
        const payload = JSON.stringify(event.usage, null, 2);
        return color ? chalk.gray(`\n📊 usage${phase}\n${payload}`) : `\n📊 usage${phase}\n${payload}`;
      }
      return '';

    case 'session_summary':
      if (verbose) {
        const payload = JSON.stringify(
          {
            ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
            iterations: event.iterations,
            usage: event.usage
          },
          null,
          2
        );
        return color ? chalk.gray(`\n📊 ${payload}`) : `\n📊 ${payload}`;
      }
      return '';

    case 'end': {
      if (event.reason === 'error' && event.error) {
        return color
          ? chalk.red(`\n✗ Error: ${event.error.message}`)
          : `\n✗ Error: ${event.error.message}`;
      }
      if (event.reason === 'aborted') {
        return color ? chalk.yellow('\n[interrupted]') : '\n[interrupted]';
      }
      if (event.reason === 'max_iterations') {
        return color ? chalk.yellow(STREAM_END_MAX_ITERATIONS_MESSAGE) : STREAM_END_MAX_ITERATIONS_MESSAGE;
      }
      return '';
    }

    case 'tool_call_delta':
    case 'tool_call_end':
      return '';

    case 'context_compressed':
      return color
        ? chalk.gray(
            `\n📦 Context compressed (${event.stats.originalMessageCount} → ${event.stats.compressedMessageCount} messages)`
          )
        : `\n📦 Context compressed (${event.stats.originalMessageCount} → ${event.stats.compressedMessageCount} messages)`;

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

function tokenUsageEqual(a: TokenUsage, b: TokenUsage): boolean {
  return (
    a.promptTokens === b.promptTokens &&
    a.completionTokens === b.completionTokens &&
    a.totalTokens === b.totalTokens
  );
}

/** Full tool call id for CLI (call vs result lines use the same string). */
function toolCallIdTag(id: string): string {
  return `[${id}]`;
}

/** CLI stream: tool invocation line (printed on `tool_call`, before execution). */
function formatStreamToolCallLine(
  verbose: boolean,
  toolCallId: string,
  name: string,
  args: unknown
): string {
  const idPart = chalk.gray(` ${toolCallIdTag(toolCallId)}`);
  if (verbose) {
    const argsStr = args != null ? ` ${JSON.stringify(args, null, 2)}` : '';
    return chalk.yellow(`\n🔧 ${name}`) + idPart + chalk.gray(argsStr);
  }
  const argsStr = args != null ? `(${truncate(JSON.stringify(args), 80)})` : '()';
  return chalk.yellow(`\n🔧 ${name}`) + idPart + chalk.gray(argsStr);
}

export function createStreamFormatter(config: OutputConfig = {}): StreamFormatter {
  const { verbose = false } = config;
  let lastEventType: string | null = null;
  let isFirstThinking = true;
  let lastPrintedUsage: TokenUsage | null = null;
  /** 工具输出后若中间插入了 model_usage 等事件，lastEventType 不再是 tool_result，需靠此标志在正文/thinking 前补换行 */
  let needsGapAfterToolBlock = false;

  return {
    format(event: StreamEvent): string {
      let output = '';

      // 无 thinking_end 时（emitThinkingBoundaries: false）从 thinking 过渡到其它事件仍要换行
      if (
        lastEventType === 'thinking' &&
        event.type !== 'thinking' &&
        event.type !== 'thinking_end'
      ) {
        output += '\n';
        isFirstThinking = true;
      }

      // 工具块结束后与助手正文或 thinking 分段（model_usage 会插在 tool_result 与 text_delta 之间，不能仅靠 lastEventType）
      if (
        needsGapAfterToolBlock &&
        (event.type === 'text_delta' || event.type === 'thinking' || event.type === 'thinking_start')
      ) {
        output += '\n';
        needsGapAfterToolBlock = false;
      }

      switch (event.type) {
        case 'text_start':
        case 'text_end':
        case 'thinking_start':
        case 'tool_call_start':
        case 'tool_call_delta':
        case 'tool_call_end':
          break;

        case 'thinking_end':
          output += '\n';
          isFirstThinking = true;
          break;

        case 'context_compressed':
          if (verbose) {
            output += chalk.gray(
              `\n📦 Context compressed: ${event.stats.originalMessageCount} → ${event.stats.compressedMessageCount} messages (${event.stats.durationMs}ms)\n`
            );
          }
          break;

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

        case 'tool_call':
          output += formatStreamToolCallLine(verbose, event.id, event.name, event.arguments);
          break;

        case 'tool_result': {
          const idTag = toolCallIdTag(event.toolCallId);
          if (verbose) {
            output +=
              chalk.green('\n✓ ') +
              chalk.gray(`${idTag} `) +
              chalk.green(`Result:\n${event.result}\n`);
          } else {
            const resultStr = truncate(event.result, 120);
            output +=
              chalk.green('\n✓ ') + chalk.gray(`${idTag} `) + chalk.green(resultStr);
          }
          needsGapAfterToolBlock = true;
          break;
        }

        case 'tool_error': {
          const idTag = toolCallIdTag(event.toolCallId);
          if (verbose) {
            output +=
              chalk.red('\n✗ ') +
              chalk.gray(`${idTag} `) +
              chalk.red(`Error:\n${event.error.message}\n`);
          } else {
            output +=
              chalk.red('\n✗ ') + chalk.gray(`${idTag} `) + chalk.red(event.error.message);
          }
          needsGapAfterToolBlock = true;
          break;
        }

        case 'model_usage': {
          const usage = event.usage;
          if (!lastPrintedUsage || !tokenUsageEqual(lastPrintedUsage, usage)) {
            lastPrintedUsage = usage;
            output += `\n${formatUsage(usage)}`;
          }
          break;
        }

        case 'session_summary': {
          const usage = event.usage;
          if (!lastPrintedUsage || !tokenUsageEqual(lastPrintedUsage, usage)) {
            lastPrintedUsage = usage;
            output += `\n${formatUsage(usage)}`;
          }
          break;
        }

        case 'end':
          if (event.reason === 'error' && event.error) {
            output += chalk.red(`\n✗ ${event.error.message}`);
          } else if (event.reason === 'aborted') {
            output += chalk.yellow('\n[interrupted]');
          } else if (event.reason === 'max_iterations') {
            output += chalk.yellow(STREAM_END_MAX_ITERATIONS_MESSAGE);
          }
          break;
      }

      lastEventType = event.type;
      return output;
    },

    finalize(): string {
      // Stream ended inside a thinking block without `thinking_end` (e.g. emitThinkingBoundaries: false)
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
 *
 * `columns[].width` 为列的最小宽度；实际宽度还会按表头与单元格内容撑开，避免截断或错位。
 */
export function formatTable(
  data: Record<string, unknown>[],
  columns: Array<{ key: string; header: string; width?: number }>
): string {
  if (data.length === 0) {
    return 'No data';
  }

  // 计算列宽（width 视为下限，避免固定宽度短于 UUID 等长内容时排版错位）
  const widths = columns.map(col => {
    const headerLen = col.header.length;
    const maxDataLen = Math.max(
      ...data.map(row => String(row[col.key] || '').length),
      0
    );
    const minW = col.width ?? 0;
    return Math.max(minW, headerLen, maxDataLen, 10);
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
