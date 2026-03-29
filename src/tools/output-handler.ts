import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { ToolResult } from '../core/types.js';

/**
 * 输出处理配置
 */
export const OUTPUT_CONFIG = {
  /** 直接返回的最大字符数 (~12k tokens) */
  maxDirectOutput: 50_000,
  /** 保存到文件的最大大小 */
  maxStorageSize: 10_000_000,
  /** 摘要显示的行数 */
  summaryHeadLines: 100,
  summaryTailLines: 100,
  /** 智能截断保留的行数 */
  truncateHeadLines: 500,
  truncateTailLines: 500,
  /** 存储目录 */
  storageDir: '.claude/tool-outputs/',
};

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
    context?: { args?: unknown; cwd?: string; userBasePath?: string }
  ): Promise<ToolResult>;
}

/**
 * 文件存储策略 (shell/MCP)
 * 保存完整内容到文件，返回摘要 + 文件路径
 */
export class FileStorageStrategy implements OutputStrategy {
  private userBasePath: string;

  constructor(userBasePath?: string) {
    this.userBasePath = userBasePath || homedir();
  }

  async handle(
    content: string,
    toolName: string,
    context?: { args?: unknown; cwd?: string; userBasePath?: string }
  ): Promise<ToolResult> {
    const basePath = context?.userBasePath || this.userBasePath;
    const timestamp = Date.now();
    const safeName = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeName}-${timestamp}.txt`;
    const storageDir = join(basePath, OUTPUT_CONFIG.storageDir);
    const filepath = join(storageDir, filename);

    try {
      // 创建目录并写入文件
      await mkdir(dirname(filepath), { recursive: true });
      await writeFile(filepath, content, 'utf-8');
    } catch (error) {
      // 文件写入失败，回退到截断策略
      const errorMessage = error instanceof Error ? error.message : String(error);
      const lines = content.split('\n');
      return {
        content:
          `Output too large (${lines.length} lines)\n\n` +
          `Failed to save to file: ${errorMessage}\n\n` +
          `Truncated output:\n${content.slice(0, OUTPUT_CONFIG.maxDirectOutput)}`,
        metadata: {
          truncated: true,
          originalLength: content.length,
          lineCount: lines.length,
        },
      };
    }

    // 生成摘要
    const lines = content.split('\n');
    const summary = this.generateSummary(content, lines);
    const sizeKB = (content.length / 1024).toFixed(1);

    return {
      content:
        `Output too large (${sizeKB} KB, ${lines.length} lines)\n\n` +
        `Summary:\n${summary}\n\n` +
        `Full output saved to: ${filepath}\n` +
        `Use 'Read' with offset/limit to view specific sections.`,
      metadata: {
        truncated: true,
        originalLength: content.length,
        storagePath: filepath,
        lineCount: lines.length,
      },
    };
  }

  private generateSummary(content: string, lines: string[]): string {
    const { summaryHeadLines, summaryTailLines } = OUTPUT_CONFIG;

    if (lines.length <= summaryHeadLines + summaryTailLines) {
      return content;
    }

    const head = lines.slice(0, summaryHeadLines).join('\n');
    const tail = lines.slice(-summaryTailLines).join('\n');
    const omitted = lines.length - summaryHeadLines - summaryTailLines;

    return `${head}\n\n... (${omitted} lines omitted) ...\n\n${tail}`;
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
    context?: { args?: unknown; cwd?: string }
  ): Promise<ToolResult> {
    const lines = content.split('\n');
    const sizeKB = (content.length / 1024).toFixed(1);
    const previewLines = OUTPUT_CONFIG.summaryHeadLines;

    // 提取文件路径（如果是从 args 中）
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
    _context?: { args?: unknown; cwd?: string }
  ): Promise<ToolResult> {
    const lines = content.split('\n');
    const { truncateHeadLines, truncateTailLines, maxDirectOutput } = OUTPUT_CONFIG;

    // 如果行数在限制内，按字符截断
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

    // 按行截断，保留首尾
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

  constructor(userBasePath?: string) {
    // 注册策略
    this.strategies.set('shell', new FileStorageStrategy(userBasePath));
    this.strategies.set('mcp', new FileStorageStrategy(userBasePath));
    this.strategies.set('filesystem', new PaginationHintStrategy());
    this.strategies.set('search', new SmartTruncateStrategy());

    // 默认策略
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
    context?: { args?: unknown; cwd?: string; userBasePath?: string }
  ): Promise<ToolResult> {
    // 内容未超限，直接返回
    if (content.length <= OUTPUT_CONFIG.maxDirectOutput) {
      return { content };
    }

    // 选择策略
    const strategy =
      this.strategies.get(category || '') || this.defaultStrategy;

    return strategy.handle(content, toolName, context);
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