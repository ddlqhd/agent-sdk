import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import {
  OutputHandler,
  createOutputHandler,
  FileStorageStrategy,
  PaginationHintStrategy,
  SmartTruncateStrategy,
  OUTPUT_CONFIG
} from '../../src/tools/output-handler.js';
import { ToolRegistry, createTool } from '../../src/tools/registry.js';
import { z } from 'zod';

describe('OutputHandler', () => {
  describe('needsHandling', () => {
    it('should return false for content under limit', () => {
      const handler = createOutputHandler();
      const shortContent = 'a'.repeat(1000);
      expect(handler.needsHandling(shortContent)).toBe(false);
    });

    it('should return true for content over limit', () => {
      const handler = createOutputHandler();
      const longContent = 'a'.repeat(OUTPUT_CONFIG.maxDirectOutput + 1);
      expect(handler.needsHandling(longContent)).toBe(true);
    });
  });

  describe('handle', () => {
    it('should return content as-is when under limit', async () => {
      const handler = createOutputHandler();
      const content = 'Hello, World!';
      const result = await handler.handle(content, 'test_tool');

      expect(result.content).toBe(content);
      expect(result.metadata?.truncated).toBeFalsy();
    });

    it('should use FileStorageStrategy for shell category', async () => {
      const handler = createOutputHandler();
      const longContent = 'a'.repeat(OUTPUT_CONFIG.maxDirectOutput + 1000);
      const result = await handler.handle(longContent, 'bash', 'shell');

      expect(result.metadata?.truncated).toBe(true);
      expect(result.metadata?.originalLength).toBe(longContent.length);
      // FileStorageStrategy 应该保存到文件
      expect(result.metadata?.storagePath).toBeDefined();
      expect(result.content).toContain('Output too large');
      expect(result.content).toContain('saved to:');
    });

    it('should use PaginationHintStrategy for filesystem category', async () => {
      const handler = createOutputHandler();
      const lines = Array(100).fill('line content');
      const longContent = lines.join('\n').repeat(1000);
      const result = await handler.handle(longContent, 'read_file', 'filesystem', {
        args: { path: '/test/file.txt' }
      });

      expect(result.metadata?.truncated).toBe(true);
      expect(result.content).toContain('Content is too large');
      expect(result.content).toContain('/test/file.txt');
      expect(result.content).toContain('read_file');
    });

    it('should use SmartTruncateStrategy for search category', async () => {
      const handler = createOutputHandler();
      // 创建超过 maxDirectOutput 的内容
      const lines = Array(5000).fill('this is a line of content for testing purposes');
      const longContent = lines.join('\n');
      const result = await handler.handle(longContent, 'grep', 'search');

      expect(result.metadata?.truncated).toBe(true);
      expect(result.metadata?.originalLineCount).toBe(5000);
      expect(result.content).toContain('lines omitted');
    });

    it('should use SmartTruncateStrategy as default', async () => {
      const handler = createOutputHandler();
      // 创建超过 maxDirectOutput 的内容
      const lines = Array(5000).fill('this is a line of content for testing purposes');
      const longContent = lines.join('\n');
      const result = await handler.handle(longContent, 'unknown_tool', undefined);

      expect(result.metadata?.truncated).toBe(true);
    });
  });
});

describe('FileStorageStrategy', () => {
  afterEach(async () => {
    // 清理测试生成的文件
    const storageDir = join(homedir(), OUTPUT_CONFIG.storageDir);
    try {
      await rm(storageDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  it('should save content to file and return summary', async () => {
    const strategy = new FileStorageStrategy();
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}`);
    const content = lines.join('\n');
    const longContent = content.repeat(100);

    const result = await strategy.handle(longContent, 'test_bash');

    expect(result.metadata?.storagePath).toBeDefined();
    expect(result.metadata?.lineCount).toBeGreaterThan(0);
    expect(result.content).toContain('Output too large');
    expect(result.content).toContain('Summary:');

    // 验证文件是否创建
    if (result.metadata?.storagePath) {
      const savedContent = await readFile(result.metadata.storagePath, 'utf-8');
      expect(savedContent).toBe(longContent);
    }
  });
});

describe('PaginationHintStrategy', () => {
  it('should show hint with file path from args', async () => {
    const strategy = new PaginationHintStrategy();
    const lines = Array(100).fill('content');
    const longContent = lines.join('\n').repeat(1000);

    const result = await strategy.handle(longContent, 'read_file', {
      args: { path: '/some/file.txt' }
    });

    expect(result.content).toContain('/some/file.txt');
    expect(result.content).toContain('read_file');
    expect(result.content).toContain('grep');
  });

  it('should show preview lines', async () => {
    const strategy = new PaginationHintStrategy();
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i}`);
    const longContent = lines.join('\n');

    const result = await strategy.handle(longContent, 'read_file');

    expect(result.content).toContain(`First ${OUTPUT_CONFIG.summaryHeadLines} lines preview`);
    expect(result.content).toContain('Line 0');
  });
});

describe('SmartTruncateStrategy', () => {
  it('should truncate by lines when many lines', async () => {
    const strategy = new SmartTruncateStrategy();
    const lines = Array.from({ length: 2000 }, (_, i) => `Line ${i}`);
    const content = lines.join('\n');

    const result = await strategy.handle(content, 'grep');

    expect(result.metadata?.originalLineCount).toBe(2000);
    expect(result.content).toContain('lines omitted');
    expect(result.content).toContain('Line 0'); // 头部保留
    expect(result.content).toContain('Line 1999'); // 尾部保留
  });

  it('should truncate by chars when few lines', async () => {
    const strategy = new SmartTruncateStrategy();
    const singleLongLine = 'a'.repeat(OUTPUT_CONFIG.maxDirectOutput + 1000);

    const result = await strategy.handle(singleLongLine, 'test');

    expect(result.metadata?.truncated).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(OUTPUT_CONFIG.maxDirectOutput + 100);
    expect(result.content).toContain('truncated');
  });
});

describe('ToolRegistry OutputHandler Integration', () => {
  it('should handle long output from tool', async () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: 'long_output_tool',
      description: 'Returns long output',
      parameters: z.object({ length: z.number() }),
      handler: async ({ length }) => ({
        content: 'a'.repeat(length)
      }),
      category: 'shell'
    }));

    const result = await registry.execute('long_output_tool', {
      length: OUTPUT_CONFIG.maxDirectOutput + 1000
    });

    expect(result.metadata?.truncated).toBe(true);
    // shell 类别使用 FileStorageStrategy，输出会被截断并保存到文件
    expect(result.metadata?.storagePath).toBeDefined();
    expect(result.content).toContain('Output too large');
  });

  it('should not modify short output', async () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: 'short_output_tool',
      description: 'Returns short output',
      parameters: z.object({}),
      handler: async () => ({
        content: 'Hello, World!'
      })
    }));

    const result = await registry.execute('short_output_tool', {});

    expect(result.content).toBe('Hello, World!');
    expect(result.metadata?.truncated).toBeFalsy();
  });

  it('should respect tool category for strategy selection', async () => {
    const registry = new ToolRegistry();

    // Shell 工具 - 应该使用 FileStorageStrategy
    registry.register(createTool({
      name: 'shell_tool',
      description: 'Shell tool',
      parameters: z.object({}),
      handler: async () => ({
        content: 'a'.repeat(OUTPUT_CONFIG.maxDirectOutput + 1000)
      }),
      category: 'shell'
    }));

    const result = await registry.execute('shell_tool', {});
    expect(result.metadata?.storagePath).toBeDefined();
  });
});