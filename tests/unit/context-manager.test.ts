import { describe, it, expect, vi } from 'vitest';
import { ContextManager } from '../../src/core/context-manager.js';
import { SummarizationCompressor } from '../../src/core/compressor.js';
import type { Message, ModelAdapter, SessionTokenUsage } from '../../src/core/types.js';

// Mock model adapter
const createMockModel = (capabilities?: { contextLength: number; maxOutputTokens?: number }): ModelAdapter => ({
  name: 'mock-model',
  capabilities: capabilities ?? { contextLength: 10_000, maxOutputTokens: 2_000 },
  stream: vi.fn(),
  complete: vi.fn().mockResolvedValue({
    content: 'Mock summary of conversation',
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
  })
});

describe('ContextManager', () => {
  describe('shouldCompress', () => {
    it('should return false when contextTokens is below threshold', () => {
      const model = createMockModel({ contextLength: 10_000, maxOutputTokens: 2_000 });
      const manager = new ContextManager(model);

      const usage: SessionTokenUsage = {
        contextTokens: 1_000,
        inputTokens: 1_000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 1_500
      };

      // usable = 10_000 - 2_000 - 2_000 = 6_000
      expect(manager.shouldCompress(usage)).toBe(false);
    });

    it('should return true when contextTokens exceeds usable', () => {
      const model = createMockModel({ contextLength: 10_000, maxOutputTokens: 2_000 });
      const manager = new ContextManager(model);

      const usage: SessionTokenUsage = {
        contextTokens: 7_000,  // 当前上下文大小超过 usable
        inputTokens: 7_000,
        outputTokens: 2_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 9_000
      };

      // usable = 10_000 - 2_000 - 2_000 = 6_000
      // 7_000 >= 6_000 -> true
      expect(manager.shouldCompress(usage)).toBe(true);
    });

    it('should only use contextTokens for compression decision', () => {
      const model = createMockModel({ contextLength: 10_000, maxOutputTokens: 2_000 });
      const manager = new ContextManager(model);

      // 即使 totalTokens 很大，只要 contextTokens 小于 usable 就不压缩
      const usage: SessionTokenUsage = {
        contextTokens: 1_000,  // 当前上下文小
        inputTokens: 1_000,
        outputTokens: 10_000,  // 累计输出大
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 11_000    // 累计总量大
      };

      // usable = 6_000, contextTokens = 1_000 < 6_000
      expect(manager.shouldCompress(usage)).toBe(false);
    });

    it('should return true when contextTokens exactly equals usable', () => {
      const model = createMockModel({ contextLength: 10_000, maxOutputTokens: 2_000 });
      const manager = new ContextManager(model);

      const usage: SessionTokenUsage = {
        contextTokens: 6_000,  // 等于 usable
        inputTokens: 6_000,
        outputTokens: 1_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 7_000
      };

      expect(manager.shouldCompress(usage)).toBe(true);
    });
  });

  describe('compress', () => {
    it('should compress messages using the compressor', async () => {
      const model = createMockModel();
      const manager = new ContextManager(model);

      const messages: Message[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'I am fine' },
        { role: 'user', content: 'Tell me more' },
        { role: 'assistant', content: 'Sure' },
        { role: 'user', content: 'More please' },
        { role: 'assistant', content: 'OK' },
        { role: 'user', content: 'Last question' }
      ];

      const result = await manager.compress(messages, 5_000);

      expect(result.stats.originalMessageCount).toBe(10);
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.stats.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should reset usage after compression', () => {
      const model = createMockModel();
      const manager = new ContextManager(model);

      const resetUsage = manager.resetUsage();

      expect(resetUsage.contextTokens).toBe(0);
      expect(resetUsage.inputTokens).toBe(0);
      expect(resetUsage.outputTokens).toBe(0);
      expect(resetUsage.cacheReadTokens).toBe(0);
      expect(resetUsage.cacheWriteTokens).toBe(0);
      expect(resetUsage.totalTokens).toBe(0);
    });
  });

  describe('prune', () => {
    it('should not prune when disabled', () => {
      const model = createMockModel();
      const manager = new ContextManager(model, { prune: false });

      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'tool', toolCallId: '1', content: 'x'.repeat(100) },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'More' },
        { role: 'tool', toolCallId: '2', content: 'y'.repeat(100) }
      ];

      const result = manager.prune(messages);
      expect(result).toEqual(messages);
    });

    it('should prune old tool outputs', () => {
      const model = createMockModel();
      const manager = new ContextManager(model, {
        prune: true,
        pruneMinimum: 100,
        pruneProtect: 200
      });

      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'tool', toolCallId: '1', content: 'x'.repeat(1000) },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'More' },
        { role: 'tool', toolCallId: '2', content: 'y'.repeat(1000) },
        { role: 'assistant', content: 'Done' },
        { role: 'user', content: 'Again' },
        { role: 'tool', toolCallId: '3', content: 'z'.repeat(1000) }
      ];

      const result = manager.prune(messages);

      // Some old tool outputs should be pruned
      const prunedCount = result.filter(m =>
        m.role === 'tool' && m.content === '[Tool output pruned to save context]'
      ).length;

      expect(prunedCount).toBeGreaterThan(0);
    });
  });

  describe('getStatus', () => {
    it('should return correct status', () => {
      const model = createMockModel({ contextLength: 10_000, maxOutputTokens: 2_000 });
      const manager = new ContextManager(model);

      const usage: SessionTokenUsage = {
        contextTokens: 3_000,  // 当前上下文大小
        inputTokens: 3_000,
        outputTokens: 1_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 4_000
      };

      const status = manager.getStatus(usage);

      expect(status.used).toBe(3_000);  // 使用 contextTokens
      expect(status.usable).toBe(6_000); // 10_000 - 2_000 - 2_000
      expect(status.needsCompaction).toBe(false);
      expect(status.compressCount).toBe(0);
    });

    it('should indicate when compaction is needed', () => {
      const model = createMockModel({ contextLength: 10_000, maxOutputTokens: 2_000 });
      const manager = new ContextManager(model);

      const usage: SessionTokenUsage = {
        contextTokens: 7_000,  // 超过 usable
        inputTokens: 7_000,
        outputTokens: 2_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 9_000
      };

      const status = manager.getStatus(usage);

      expect(status.needsCompaction).toBe(true);
    });
  });
});

describe('SummarizationCompressor', () => {
  it('should compress messages with LLM summary', async () => {
    const model = createMockModel();
    const compressor = new SummarizationCompressor(model, {
      preserveRecent: 4
    });

    const messages: Message[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Question 1' },
      { role: 'assistant', content: 'Answer 1' },
      { role: 'user', content: 'Question 2' },
      { role: 'assistant', content: 'Answer 2' },
      { role: 'user', content: 'Question 3' },
      { role: 'assistant', content: 'Answer 3' }
    ];

    const result = await compressor.compress(messages, 5_000);

    // Should have system + summary + recent messages
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].role).toBe('system');
  });

  it('should not compress when messages are too few', async () => {
    const model = createMockModel();
    const compressor = new SummarizationCompressor(model, {
      preserveRecent: 6
    });

    const messages: Message[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' }
    ];

    const result = await compressor.compress(messages, 5_000);

    // Should return original messages
    expect(result).toEqual(messages);
  });

  it('should preserve recent messages', async () => {
    const model = createMockModel();
    const compressor = new SummarizationCompressor(model, {
      preserveRecent: 2
    });

    const messages: Message[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Old question' },
      { role: 'assistant', content: 'Old answer' },
      { role: 'user', content: 'Recent question' },
      { role: 'assistant', content: 'Recent answer' }
    ];

    const result = await compressor.compress(messages, 5_000);

    // Should have system + summary + 2 recent messages
    expect(result.length).toBe(4);
    expect(result[result.length - 2].content).toBe('Recent question');
    expect(result[result.length - 1].content).toBe('Recent answer');
  });
});
