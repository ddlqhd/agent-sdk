import type { Message, ModelAdapter } from './types.js';

/**
 * 压缩器接口
 */
export interface Compressor {
  /** 压缩名称 (用于日志) */
  name: string;

  /**
   * 执行压缩
   * @param messages 原始消息列表
   * @param targetTokens 目标 token 数
   * @returns 压缩后的消息列表
   */
  compress(messages: Message[], targetTokens: number): Promise<Message[]>;
}

/**
 * 压缩结果
 */
export interface CompressionResult {
  /** 压缩后的消息 */
  messages: Message[];
  /** 压缩统计 */
  stats: CompressionStats;
}

/**
 * 压缩统计
 */
export interface CompressionStats {
  /** 原始消息数 */
  originalMessageCount: number;
  /** 压缩后消息数 */
  compressedMessageCount: number;
  /** 压缩耗时 (ms) */
  durationMs: number;
}

/**
 * 摘要压缩器选项
 */
export interface SummarizationCompressorOptions {
  /** 保留的最近消息数, 默认 6 */
  preserveRecent?: number;
  /** 摘要系统提示 */
  summaryPrompt?: string;
  /** 摘要最大 token 数, 默认 4000 */
  maxSummaryTokens?: number;
}

/**
 * 结构化摘要压缩器
 *
 * 借鉴 Opencode 的压缩模板，保留关键上下文信息
 */
export class SummarizationCompressor implements Compressor {
  name = 'summarization';

  constructor(
    private model: ModelAdapter,
    private options: SummarizationCompressorOptions = {}
  ) {}

  async compress(messages: Message[], targetTokens: number): Promise<Message[]> {
    const preserveRecent = this.options.preserveRecent ?? 6;

    // 1. 分离系统消息、待压缩消息、保留消息
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    if (nonSystemMessages.length <= preserveRecent) {
      return messages;
    }

    const recentMessages = nonSystemMessages.slice(-preserveRecent);
    const messagesToSummarize = nonSystemMessages.slice(0, -preserveRecent);

    // 2. 构建摘要提示
    const summaryPrompt = this.options.summaryPrompt ?? this.buildDefaultPrompt();

    // 3. 调用 LLM 生成摘要
    const maxTokens = Math.min(
      this.options.maxSummaryTokens ?? 4000,
      Math.floor(targetTokens * 0.3)
    );

    const summaryResponse = await this.model.complete({
      messages: [
        { role: 'system', content: summaryPrompt },
        ...messagesToSummarize,
      ],
      maxTokens,
    });

    // 4. 构建压缩后的消息列表
    return [
      ...systemMessages,
      {
        role: 'system' as const,
        content: this.wrapSummary(summaryResponse.content),
      },
      ...recentMessages,
    ];
  }

  /**
   * 构建默认摘要提示 (借鉴 Opencode 模板)
   */
  private buildDefaultPrompt(): string {
    return `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary that you construct will be used so that another agent can read it and continue the work.

When constructing the summary, try to stick to this template:
---
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]

## Discoveries

[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]
---`;
  }

  /**
   * 包装摘要为 continuation 格式 (借鉴 Opencode)
   */
  private wrapSummary(summary: string): string {
    return `This session is being continued from a previous conversation that ran out of context.
The summary below covers the earlier portion of the conversation.

${summary}

Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.`;
  }
}
