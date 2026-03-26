import type { Message, ModelAdapter, SessionTokenUsage, ContextManagerConfig } from './types.js';
import type { Compressor, CompressionResult } from './compressor.js';
import { SummarizationCompressor } from './compressor.js';

/**
 * 上下文状态
 */
export type { ContextManagerConfig as ContextManagerOptions } from './types.js';

export interface ContextStatus {
  /** 当前使用 tokens (从 API 获取) */
  used: number;
  /** 可用空间 */
  usable: number;
  /** 是否需要压缩 */
  needsCompaction: boolean;
  /** 压缩次数 */
  compressCount: number;
}

/**
 * 上下文管理器
 *
 * 核心设计 (借鉴 Opencode):
 * - Token 计算完全依赖 API 返回的实际值，不做本地估算
 * - 压缩触发: contextTokens >= usable (context - output预留 - 压缩缓冲)
 * - contextTokens: 当前上下文大小（用于压缩判断）
 * - inputTokens: 累计输入消耗
 * - 支持 prune 清理旧的工具输出
 */
export class ContextManager {
  private compressor: Compressor;
  private reserved: number;
  private pruneEnabled: boolean;
  private pruneMinimum: number;
  private pruneProtect: number;
  private compressCount = 0;

  private _contextLength: number;
  private _maxOutputTokens: number;

  constructor(model: ModelAdapter, options: ContextManagerConfig = {}) {
    // 从模型 capabilities 获取上下文长度
    const contextLength = options.contextLength ?? model.capabilities?.contextLength ?? 128_000;
    const maxOutputTokens = options.maxOutputTokens ?? model.capabilities?.maxOutputTokens ?? 32_768;

    this._contextLength = contextLength;
    this._maxOutputTokens = maxOutputTokens;
    this.reserved = options.reserved ?? Math.min(20_000, maxOutputTokens);
    this.pruneEnabled = options.prune !== false;
    this.pruneMinimum = options.pruneMinimum ?? 20_000;
    this.pruneProtect = options.pruneProtect ?? 40_000;

    this.compressor = options.compressor ?? new SummarizationCompressor(model);
  }

  /**
   * 计算可用空间
   *
   * usable = contextLength - maxOutputTokens - reserved
   */
  get usable(): number {
    return this._contextLength - this._maxOutputTokens - this.reserved;
  }

  /**
   * 判断是否需要压缩
   *
   * 使用当前上下文大小 (contextTokens) 判断，而非累计值
   *
   * @param usage 会话 token 使用量
   */
  shouldCompress(usage: SessionTokenUsage): boolean {
    // 使用 contextTokens (当前上下文大小)
    return usage.contextTokens >= this.usable;
  }

  /**
   * 执行压缩
   */
  async compress(
    messages: Message[],
    targetTokens?: number
  ): Promise<CompressionResult> {
    const startTime = Date.now();
    const originalCount = messages.length;

    const target = targetTokens ?? Math.floor(this.usable * 0.6);
    const compressedMessages = await this.compressor.compress(messages, target);

    this.compressCount++;

    return {
      messages: compressedMessages,
      stats: {
        originalMessageCount: originalCount,
        compressedMessageCount: compressedMessages.length,
        durationMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Prune: 清理旧的工具输出
   *
   * 借鉴 Opencode 的 prune 策略:
   * - 从后往前遍历消息
   * - 保留最近 PRUNE_PROTECT tokens 的工具输出
   * - 清理更早的工具输出
   *
   * @param messages 消息列表
   * @returns 处理后的消息列表
   */
  prune(messages: Message[]): Message[] {
    if (!this.pruneEnabled) return messages;

    let total = 0;
    const toPrune: number[] = [];
    let turns = 0;

    // 从后往前遍历
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];

      if (msg.role === 'user') turns++;
      if (turns < 2) continue;

      // 工具结果消息
      if (msg.role === 'tool') {
        const estimate = this.estimateTokens(typeof msg.content === 'string' ? msg.content : '');
        total += estimate;

        if (total > this.pruneProtect) {
          toPrune.push(i);
        }
      }
    }

    // 如果需要 prune 的 token 数足够多
    if (toPrune.length > 0) {
      const prunedTokens = toPrune.reduce((sum, idx) => {
        const content = messages[idx].content;
        return sum + this.estimateTokens(typeof content === 'string' ? content : '');
      }, 0);

      if (prunedTokens >= this.pruneMinimum) {
        return messages.map((msg, idx) => {
          if (toPrune.includes(idx) && msg.role === 'tool') {
            return {
              ...msg,
              content: '[Tool output pruned to save context]',
            };
          }
          return msg;
        });
      }
    }

    return messages;
  }

  /**
   * 获取上下文状态
   */
  getStatus(usage: SessionTokenUsage): ContextStatus {
    return {
      used: usage.contextTokens,
      usable: this.usable,
      needsCompaction: usage.contextTokens >= this.usable,
      compressCount: this.compressCount,
    };
  }

  /**
   * 重置 token 使用量 (压缩后调用)
   */
  resetUsage(): SessionTokenUsage {
    return {
      contextTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
    };
  }

  /**
   * Token 估算 (仅用于 prune，不做压缩判断)
   *
   * 借鉴 Opencode: CHARS_PER_TOKEN = 4
   */
  private estimateTokens(text: string): number {
    return Math.max(0, Math.round((text || '').length / 4));
  }
}
