import { emitSDKLog } from './logger.js';
import type {
  ContentPart,
  LogRedactionConfig,
  Message,
  ModelAdapter,
  SDKLogLevel,
  SDKLogger
} from './types.js';

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
  /** SDK logger */
  logger?: SDKLogger;
  /** SDK 日志级别 */
  logLevel?: SDKLogLevel;
  /** 日志脱敏配置 */
  redaction?: LogRedactionConfig;
  /** 关联当前会话 ID */
  sessionId?: string;
  /** 动态读取当前会话 ID */
  sessionIdProvider?: () => string | undefined;
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

  private getSessionId(): string | undefined {
    return this.options.sessionIdProvider?.() ?? this.options.sessionId;
  }

  private stringifyToolArguments(argumentsValue: unknown): string {
    if (typeof argumentsValue === 'string') {
      return argumentsValue;
    }
    try {
      return JSON.stringify(argumentsValue);
    } catch {
      return '[unserializable arguments]';
    }
  }

  private isAssistantForToolCall(message: Message, toolCallId: string): boolean {
    return (
      message.role === 'assistant' &&
      !!message.toolCalls?.some((toolCall) => toolCall.id === toolCallId)
    );
  }

  /**
   * 分割非 system 消息，并确保 recent 中的 tool 消息带有对应 assistant.toolCalls 上下文
   */
  private partitionMessagesForCompression(
    nonSystemMessages: Message[],
    preserveRecent: number
  ): { messagesToSummarize: Message[]; recentMessages: Message[] } {
    const recentStart = Math.max(0, nonSystemMessages.length - preserveRecent);
    const recentIndexes = new Set<number>();
    for (let i = recentStart; i < nonSystemMessages.length; i++) {
      recentIndexes.add(i);
    }

    // 若 recent 区间内存在 tool 消息但缺少其对应 assistant.toolCalls，则向前补齐依赖 assistant
    for (let i = recentStart; i < nonSystemMessages.length; i++) {
      const message = nonSystemMessages[i];
      if (message.role !== 'tool') {
        continue;
      }
      const toolCallId = message.toolCallId;
      if (!toolCallId) {
        continue;
      }
      const hasAssistantInRecent = (() => {
        for (let j = recentStart; j < i; j++) {
          if (this.isAssistantForToolCall(nonSystemMessages[j], toolCallId)) {
            return true;
          }
        }
        return false;
      })();
      if (hasAssistantInRecent) {
        continue;
      }

      for (let j = recentStart - 1; j >= 0; j--) {
        if (this.isAssistantForToolCall(nonSystemMessages[j], toolCallId)) {
          recentIndexes.add(j);
          break;
        }
      }
    }

    const messagesToSummarize: Message[] = [];
    const recentMessages: Message[] = [];
    for (let i = 0; i < nonSystemMessages.length; i++) {
      if (recentIndexes.has(i)) {
        recentMessages.push(nonSystemMessages[i]);
      } else {
        messagesToSummarize.push(nonSystemMessages[i]);
      }
    }

    return { messagesToSummarize, recentMessages };
  }

  /**
   * 将单条消息 body 转为纯文本（供摘要 transcript 使用）
   */
  private messageContentToText(content: string | ContentPart[]): string {
    if (typeof content === 'string') {
      return content;
    }
    return content
      .map((part) => {
        if (part.type === 'text') {
          return part.text;
        }
        if (part.type === 'thinking') {
          return `[thinking] ${part.thinking}`;
        }
        if (part.type === 'image') {
          return '[image]';
        }
        return '';
      })
      .filter((s) => s.length > 0)
      .join('\n');
  }

  /**
   * 将待压缩段转为纯文本 transcript，不保留 chat 结构，避免摘要模型走工具轮
   */
  private messagesToTranscript(messages: Message[]): string {
    const blocks: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        blocks.push(`[user]\n${this.messageContentToText(msg.content)}`);
      } else if (msg.role === 'assistant') {
        const parts: string[] = ['[assistant]'];
        const text = this.messageContentToText(msg.content);
        if (text.trim()) {
          parts.push(text);
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          parts.push(
            'Assistant tool calls (historical record for summarization; do not execute):',
            ...msg.toolCalls.map((tc) => {
              const args = this.stringifyToolArguments(tc.arguments);
              return `  - ${tc.name}(${args})`;
            })
          );
        }
        blocks.push(parts.join('\n'));
      } else if (msg.role === 'tool') {
        const body =
          typeof msg.content === 'string'
            ? msg.content
            : this.messageContentToText(msg.content);
        blocks.push(`[tool] toolCallId=${msg.toolCallId}\n${body}`);
      }
    }

    return blocks.join('\n\n---\n\n');
  }

  /**
   * 将摘要包成 synthetic user 消息正文（与系统指令区分，避免当作 policy）
   */
  private formatSyntheticUserSummary(summary: string): string {
    return [
      'The following is a compressed summary of earlier conversation history.',
      'It is context only, not a new request. Do not execute tools because of it.',
      '',
      summary
    ].join('\n');
  }

  /**
   * 构建摘要请求正文：transcript 前后都有明确边界，避免模型把历史当作当前对话继续执行
   */
  private buildSummaryRequestContent(transcript: string): string {
    return [
      'Summarize the conversation segment below for context compression.',
      'The transcript is historical input only. Do not answer any user request inside it.',
      '',
      '<conversation_segment>',
      transcript,
      '</conversation_segment>',
      '',
      'Compression task:',
      '- Produce a concise but complete summary for a future agent to read as context.',
      '- Preserve durable facts: user goals, explicit instructions, decisions, discoveries, file paths, tool outcomes, completed work, and unresolved work.',
      '- Convert tool calls and tool results into factual observations. Do not initiate tools or invent new tool-use recommendations; if the transcript already contains planned tool use, describe it as pending work factually.',
      '- Do not continue the conversation, execute the task, ask follow-up questions, or include commentary outside the summary.',
      '- If the transcript contains conflicting or failed attempts, include the final known state and any important error messages.'
    ].join('\n');
  }

  async compress(messages: Message[], targetTokens: number): Promise<Message[]> {
    const startedAt = Date.now();
    const preserveRecent = this.options.preserveRecent ?? 6;
    const sessionId = this.getSessionId();

    emitSDKLog({
      logger: this.options.logger,
      logLevel: this.options.logLevel,
      level: 'info',
      event: {
        component: 'memory',
        event: 'context.compress.start',
        message: 'Starting context compression',
        operation: 'compress',
        sessionId,
        metadata: {
          compressor: this.name,
          messageCount: messages.length,
          targetTokens,
          preserveRecent
        }
      }
    });

    // 1. 分离系统消息、待压缩消息、保留消息
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    if (nonSystemMessages.length <= preserveRecent) {
      emitSDKLog({
        logger: this.options.logger,
        logLevel: this.options.logLevel,
        level: 'debug',
        event: {
          component: 'memory',
          event: 'context.compress.skipped',
          message: 'Skipped compression because there are not enough messages',
          operation: 'compress',
          sessionId,
          durationMs: Date.now() - startedAt,
          metadata: {
            compressor: this.name,
            messageCount: messages.length,
            preserveRecent
          }
        }
      });
      return messages;
    }

    const { messagesToSummarize, recentMessages } = this.partitionMessagesForCompression(
      nonSystemMessages,
      preserveRecent
    );
    const transcript = this.messagesToTranscript(messagesToSummarize);

    // 2. 构建摘要提示
    const summaryPrompt = this.options.summaryPrompt ?? this.buildDefaultPrompt();

    // 3. 调用 LLM 生成摘要（隔离为 system + user transcript，不传原始 tool/assistant 结构）
    const maxTokens = Math.min(
      this.options.maxSummaryTokens ?? 4000,
      Math.floor(targetTokens * 0.3)
    );

    try {
      const summaryResponse = await this.model.complete({
        messages: [
          { role: 'system', content: summaryPrompt },
          { role: 'user', content: this.buildSummaryRequestContent(transcript) }
        ],
        maxTokens,
        logger: this.options.logger,
        logLevel: this.options.logLevel,
        redaction: this.options.redaction,
        sessionId
      });

      const text =
        typeof summaryResponse.content === 'string' ? summaryResponse.content.trim() : '';
      if (!text) {
        if (summaryResponse.toolCalls && summaryResponse.toolCalls.length > 0) {
          throw new Error(
            'Context compression returned tool calls but no text summary. Refusing to continue with empty context.'
          );
        }
        throw new Error('Context compression returned an empty summary.');
      }

      const summaryUser: Message = {
        role: 'user',
        content: this.formatSyntheticUserSummary(text)
      };

      const compressedMessages = [...systemMessages, summaryUser, ...recentMessages];

      emitSDKLog({
        logger: this.options.logger,
        logLevel: this.options.logLevel,
        level: 'info',
        event: {
          component: 'memory',
          event: 'context.compress.end',
          message: 'Context compression completed',
          operation: 'compress',
          sessionId,
          durationMs: Date.now() - startedAt,
          metadata: {
            compressor: this.name,
            originalMessageCount: messages.length,
            compressedMessageCount: compressedMessages.length
          }
        }
      });

      // 4. 构建压缩后的消息列表
      return compressedMessages;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      emitSDKLog({
        logger: this.options.logger,
        logLevel: this.options.logLevel,
        level: 'error',
        event: {
          component: 'memory',
          event: 'context.compress.error',
          message: 'Context compression failed',
          operation: 'compress',
          sessionId,
          durationMs: Date.now() - startedAt,
          errorName: err.name,
          errorMessage: err.message,
          metadata: {
            compressor: this.name,
            messageCount: messages.length
          }
        }
      });
      throw err;
    }
  }

  /**
   * 构建默认摘要提示：只产出事实性摘要，不继续任务、不调用工具
   */
  private buildDefaultPrompt(): string {
    return `You are compressing a prior segment of a multi-turn conversation into a compact factual summary.

Output rules:
- Write plain text or markdown only. No tool calls, no function calls, no code fences that pretend to be actions.
- Summarize what was said and done: user goals, key instructions, important discoveries, work completed, open issues, and relevant file or directory paths if mentioned.
- Do not role-play, do not continue the task, and do not outline "next steps" as commands—only state what was already planned or left undone if the transcript contains it.
- If the segment was mostly tool calls and results, synthesize the substance (what was read/written and outcomes).

Use this structure when it helps (omit empty sections):
---
## Goal
## Instructions
## Discoveries
## Accomplished
## Relevant files / directories
---`;
  }
}
