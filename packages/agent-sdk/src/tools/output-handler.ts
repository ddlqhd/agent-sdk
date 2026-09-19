import { homedir } from 'os';
import {
  createLocalEnvironment,
  getDefaultLocalEnvironment,
  SPILL_MAX_DIRECT_CHARS,
  SPILL_MAX_STORAGE_CHARS,
  SPILL_SUMMARY_HEAD_LINES,
  SPILL_SUMMARY_TAIL_LINES,
  type Environment
} from '@ddlqhd/agent-sdk-exec';
import type { ToolResult } from '../core/types.js';

/**
 * 输出处理配置
 */
export const OUTPUT_CONFIG = {
  /** 直接返回的最大字符数 (~12k tokens) */
  maxDirectOutput: SPILL_MAX_DIRECT_CHARS,
  /** 保存到文件的最大大小 */
  maxStorageSize: SPILL_MAX_STORAGE_CHARS,
  /** 摘要显示的行数 */
  summaryHeadLines: SPILL_SUMMARY_HEAD_LINES,
  summaryTailLines: SPILL_SUMMARY_TAIL_LINES,
  /** 智能截断保留的行数 */
  truncateHeadLines: 500,
  truncateTailLines: 500,
  /** 存储目录（相对执行面 userHome） */
  storageDir: '.claude/tool-outputs/',
};

export interface OutputHandleContext {
  args?: unknown;
  cwd?: string;
  userBasePath?: string;
  environment?: Environment;
}

/**
 * 输出策略接口
 */
export interface OutputStrategy {
  /**
   * 处理超长输出
   * @param content 原始内容
   * @param toolName 工具名称
   * @param context 上下文信息
   */
  handle(
    content: string,
    toolName: string,
    context?: OutputHandleContext
  ): Promise<ToolResult>;
}

function resolveSpillEnvironment(context?: OutputHandleContext, fallbackUserHome?: string): Environment {
  if (context?.environment) {
    return context.environment;
  }
  const userHome = context?.userBasePath || fallbackUserHome;
  if (userHome && userHome !== homedir()) {
    return createLocalEnvironment({ userHome });
  }
  return getDefaultLocalEnvironment();
}

/**
 * 文件存储策略 (shell / MCP / web)
 * 在执行面 spill 完整内容，返回摘要 + 文件路径；可用 Read 的 offset/limit 分页查看
 */
export class FileStorageStrategy implements OutputStrategy {
  private userBasePath: string;

  constructor(userBasePath?: string) {
    this.userBasePath = userBasePath || homedir();
  }

  async handle(
    content: string,
    toolName: string,
    context?: OutputHandleContext
  ): Promise<ToolResult> {
    const env = resolveSpillEnvironment(context, this.userBasePath);
    const spilled = await env.fs.spillText(content, { toolName });
    if (!spilled.spilled) {
      if (spilled.content !== content) {
        return {
          content: spilled.content,
          metadata: {
            truncated: true,
            originalLength: spilled.originalLength,
            lineCount: spilled.lineCount,
            storageTruncated: spilled.storageTruncated
          }
        };
      }
      return { content };
    }

    return {
      content: spilled.content,
      metadata: {
        truncated: true,
        originalLength: spilled.originalLength,
        storagePath: spilled.storagePath,
        lineCount: spilled.lineCount,
        storageTruncated: spilled.storageTruncated
      }
    };
  }
}

/**
 * 分页提示策略 (filesystem)
 * 提示用户使用分页参数，显示预览
 */
export class PaginationHintStrategy implements OutputStrategy {
  async handle(
    content: string,
    _toolName: string,
    context?: OutputHandleContext
  ): Promise<ToolResult> {
    const lines = content.split('\n');
    const sizeKB = (content.length / 1024).toFixed(1);
    const previewLines = OUTPUT_CONFIG.summaryHeadLines;

    const filePath = this.extractFilePath(context?.args);

    let hint = `Content is too large (${lines.length} lines, ${sizeKB} KB)\n\n`;

    if (filePath) {
      hint += `To read efficiently:\n`;
      hint += `1. Use 'Read' with offset and limit:\n`;
      hint += `   Read(file_path="${filePath}", offset=1, limit=500)\n\n`;
      hint += `2. Use 'Grep' to search for patterns:\n`;
      hint += `   Grep(pattern="keyword", path="${filePath}")\n\n`;
    }

    hint += `First ${previewLines} lines preview:\n`;
    hint += lines.slice(0, previewLines).join('\n');

    if (lines.length > previewLines) {
      hint += `\n\n... (${lines.length - previewLines} more lines)`;
    }

    return {
      content: hint,
      metadata: {
        truncated: true,
        originalLength: content.length,
        lineCount: lines.length,
      },
    };
  }

  private extractFilePath(args: unknown): string | null {
    if (typeof args === 'object' && args !== null) {
      const a = args as Record<string, unknown>;
      if (typeof a.path === 'string') return a.path;
      if (typeof a.file_path === 'string') return a.file_path;
    }
    return null;
  }
}

/**
 * 智能截断策略 (search/默认)
 * 保留首尾内容，显示省略统计
 */
export class SmartTruncateStrategy implements OutputStrategy {
  async handle(
    content: string,
    _toolName: string,
    _context?: OutputHandleContext
  ): Promise<ToolResult> {
    const lines = content.split('\n');
    const { truncateHeadLines, truncateTailLines, maxDirectOutput } = OUTPUT_CONFIG;

    if (lines.length <= truncateHeadLines + truncateTailLines) {
      const truncated =
        content.slice(0, maxDirectOutput) +
        `\n\n... [truncated, ${content.length} total chars]`;
      return {
        content: truncated,
        metadata: {
          truncated: true,
          originalLength: content.length,
          lineCount: lines.length,
        },
      };
    }

    const head = lines.slice(0, truncateHeadLines);
    const tail = lines.slice(-truncateTailLines);
    const omitted = lines.length - truncateHeadLines - truncateTailLines;

    const result =
      head.join('\n') +
      `\n\n... [${omitted} lines omitted] ...\n\n` +
      tail.join('\n');

    return {
      content: result,
      metadata: {
        truncated: true,
        originalLength: content.length,
        originalLineCount: lines.length,
        displayedLineCount: truncateHeadLines + truncateTailLines,
      },
    };
  }
}

/**
 * 输出处理器
 * 根据工具类别选择合适的处理策略
 */
export class OutputHandler {
  private strategies: Map<string, OutputStrategy> = new Map();
  private defaultStrategy: OutputStrategy;
  private userBasePath?: string;

  constructor(userBasePath?: string) {
    this.userBasePath = userBasePath;
    this.strategies.set('shell', new FileStorageStrategy(userBasePath));
    this.strategies.set('mcp', new FileStorageStrategy(userBasePath));
    this.strategies.set('web', new FileStorageStrategy(userBasePath));
    this.strategies.set('filesystem', new PaginationHintStrategy());
    this.strategies.set('search', new SmartTruncateStrategy());
    this.defaultStrategy = new SmartTruncateStrategy();
  }

  /**
   * 处理工具输出
   * @param content 工具输出内容
   * @param toolName 工具名称
   * @param category 工具类别
   * @param context 上下文信息
   */
  async handle(
    content: string,
    toolName: string,
    category?: string,
    context?: OutputHandleContext
  ): Promise<ToolResult> {
    if (content.length <= OUTPUT_CONFIG.maxDirectOutput) {
      return { content };
    }

    const strategy =
      this.strategies.get(category || '') || this.defaultStrategy;

    return strategy.handle(content, toolName, {
      ...context,
      userBasePath: context?.userBasePath ?? this.userBasePath
    });
  }

  /**
   * 注册自定义策略
   */
  registerStrategy(category: string, strategy: OutputStrategy): void {
    this.strategies.set(category, strategy);
  }

  /**
   * 检查内容是否需要处理
   */
  needsHandling(content: string): boolean {
    return content.length > OUTPUT_CONFIG.maxDirectOutput;
  }
}

/**
 * 创建输出处理器
 */
export function createOutputHandler(userBasePath?: string): OutputHandler {
  return new OutputHandler(userBasePath);
}
