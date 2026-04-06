import type {
  ModelParams,
  ModelCapabilities,
  StreamChunk,
  CompletionResult
} from '../core/types.js';
import { BaseModelAdapter, toolsToModelSchema } from './base.js';

/**
 * Anthropic 模型能力映射
 */
const ANTHROPIC_CAPABILITIES: Record<string, ModelCapabilities> = {
  'claude-sonnet-4-20250514': { contextLength: 200_000, maxOutputTokens: 16_384 },
  'claude-haiku': { contextLength: 200_000, maxOutputTokens: 8_192 },
  'claude-3-5-sonnet-20241022': { contextLength: 200_000, maxOutputTokens: 8_192 },
  'claude-3-haiku-20240307': { contextLength: 200_000, maxOutputTokens: 4_096 },
};

/**
 * Anthropic 配置
 */
export interface AnthropicConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  version?: string;
  /** 自定义模型能力 (覆盖默认值) */
  capabilities?: ModelCapabilities;
}

/**
 * Anthropic 模型适配器
 */
export class AnthropicAdapter extends BaseModelAdapter {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private version: string;

  constructor(config: AnthropicConfig = {}) {
    super();
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = config.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.version = config.version || '2023-06-01';

    if (!this.apiKey) {
      throw new Error('Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable or pass apiKey in config.');
    }

    this.name = `anthropic/${this.model}`;

    // 设置模型能力
    this.capabilities = config.capabilities
      ?? ANTHROPIC_CAPABILITIES[this.model]
      ?? { contextLength: 200_000, maxOutputTokens: 4_096 };
  }

  async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(params, true);
    const response = await this.fetch('/v1/messages', body, params.signal);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall: { id: string; name: string; input: string } | null = null;
    let currentThinkingBlock: { signature?: string } | null = null;

    try {
      while (true) {
        if (params.signal?.aborted) {
          reader.cancel();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          // 跳过 'data:' 前缀，可能有空格
          let jsonStart = 5;
          if (trimmed.length > 5 && trimmed[5] === ' ') {
            jsonStart = 6;
          }
          const jsonStr = trimmed.slice(jsonStart);

          try {
            const data = JSON.parse(jsonStr);
            const raw = params.includeRawStreamEvents ? { providerRaw: data as unknown } : {};

            switch (data.type) {
              case 'content_block_start':
                if (data.content_block?.type === 'tool_use') {
                  currentToolCall = {
                    id: data.content_block.id,
                    name: data.content_block.name,
                    input: ''
                  };
                  yield {
                    type: 'tool_call_start',
                    toolCall: {
                      id: data.content_block.id,
                      name: data.content_block.name,
                      arguments: {}
                    },
                    ...raw
                  };
                } else if (data.content_block?.type === 'thinking') {
                  currentThinkingBlock = {
                    signature: data.content_block.signature
                  };
                  yield {
                    type: 'thinking',
                    content: data.content_block.thinking,
                    signature: currentThinkingBlock.signature,
                    ...raw
                  };
                }
                break;

              case 'content_block_delta':
                if (data.delta?.type === 'text_delta') {
                  yield { type: 'text', content: data.delta.text, ...raw };
                } else if (data.delta?.type === 'thinking_delta') {
                  yield {
                    type: 'thinking',
                    content: data.delta.thinking,
                    signature: currentThinkingBlock?.signature,
                    ...raw
                  };
                } else if (data.delta?.type === 'input_json_delta' && currentToolCall) {
                  currentToolCall.input += data.delta.partial_json;
                  yield {
                    type: 'tool_call_delta',
                    content: data.delta.partial_json,
                    toolCallId: currentToolCall.id,
                    ...raw
                  };
                }
                break;

              case 'content_block_stop':
                if (currentToolCall) {
                  yield {
                    type: 'tool_call',
                    toolCall: {
                      id: currentToolCall.id,
                      name: currentToolCall.name,
                      arguments: this.safeParseJSON(currentToolCall.input)
                    },
                    ...raw
                  };
                  currentToolCall = null;
                }
                if (currentThinkingBlock) {
                  currentThinkingBlock = null;
                }
                break;

              case 'message_start':
                if (data.message?.usage) {
                  const usage = data.message.usage;
                  // Anthropic 的 input_tokens 已扣除缓存命中的部分
                  // 完整的上下文大小 = input_tokens + cache_read_input_tokens
                  const actualInputTokens = usage.input_tokens + (usage.cache_read_input_tokens || 0);
                  yield {
                    type: 'metadata',
                    usagePhase: 'input',
                    metadata: {
                      usage: {
                        promptTokens: actualInputTokens,
                        completionTokens: 0,
                        totalTokens: actualInputTokens,
                        // 传递缓存信息
                        cacheReadTokens: usage.cache_read_input_tokens || 0,
                        cacheWriteTokens: usage.cache_creation_input_tokens || 0
                      }
                    },
                    ...raw
                  };
                }
                break;

              case 'message_delta':
                if (data.usage) {
                  yield {
                    type: 'metadata',
                    usagePhase: 'output',
                    metadata: {
                      usage: {
                        promptTokens: 0,
                        completionTokens: data.usage.output_tokens,
                        totalTokens: data.usage.output_tokens
                      }
                    },
                    ...raw
                  };
                }
                break;
            }
          } catch {
            // 跳过解析错误
          }
        }
      }

      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }

  async complete(params: ModelParams): Promise<CompletionResult> {
    const body = this.buildRequestBody(params, false);
    const response = await this.fetch('/v1/messages', body);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    const result: CompletionResult = {
      content: ''
    };

    // 处理内容块
    const toolCalls: any[] = [];
    for (const block of data.content || []) {
      if (block.type === 'text') {
        result.content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input
        });
      }
    }

    if (toolCalls.length > 0) {
      result.toolCalls = toolCalls;
    }

    // 处理使用统计
    if (data.usage) {
      const usage = data.usage;
      // Anthropic 的 input_tokens 已扣除缓存命中的部分
      // 完整的上下文大小 = input_tokens + cache_read_input_tokens
      const actualInputTokens = usage.input_tokens + (usage.cache_read_input_tokens || 0);
      result.usage = {
        promptTokens: actualInputTokens,
        completionTokens: usage.output_tokens,
        totalTokens: actualInputTokens + usage.output_tokens
      };
    }

    return result;
  }

  private buildRequestBody(params: ModelParams, stream: boolean): unknown {
    const { system, messages } = this.extractSystemMessage(params.messages);
    const transformedMessages = this.transformAnthropicMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: params.maxTokens || 4096,
      messages: transformedMessages,
      stream,
      ...(system && { system }),
      ...(params.temperature !== undefined && { temperature: params.temperature })
    };

    // 添加工具
    if (params.tools && params.tools.length > 0) {
      body.tools = toolsToModelSchema(params.tools).map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters
      }));
    }

    return body;
  }

  private extractSystemMessage(messages: ModelParams['messages']): {
    system?: string;
    messages: ModelParams['messages'];
  } {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    // 合并多条 system 消息为一条
    const combinedSystem = systemMessages.length > 0
      ? systemMessages.map(m => m.content as string).join('\n\n')
      : undefined;

    return {
      system: combinedSystem,
      messages: otherMessages
    };
  }

  private transformAnthropicMessages(messages: ModelParams['messages']): unknown[] {
    return messages.map(msg => {
      const transformed: Record<string, unknown> = {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: []
      };

      if (typeof msg.content === 'string') {
        transformed.content = [{ type: 'text', text: msg.content }];
      } else if (Array.isArray(msg.content)) {
        // 处理 ContentPart 数组
        const contentParts: any[] = [];
        for (const part of msg.content) {
          if (part.type === 'thinking') {
            contentParts.push(part);
          } else if (part.type === 'text') {
            contentParts.push({ type: 'text', text: (part as any).text });
          } else {
            contentParts.push(part);
          }
        }
        transformed.content = contentParts;

        // 如果过滤后为空，设置空字符串
        if (contentParts.length === 0) {
          transformed.content = '';
        }
      }

      // 处理工具调用
      if (msg.toolCalls && msg.role === 'assistant') {
        for (const tc of msg.toolCalls) {
          (transformed.content as any[]).push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments
          });
        }
      }

      // 处理工具结果
      if (msg.role === 'tool' && msg.toolCallId) {
        transformed.role = 'user';
        transformed.content = [{
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: msg.content
        }];
      }

      return transformed;
    });
  }

  private async fetch(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    return globalThis.fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.version
      },
      body: JSON.stringify(body),
      signal
    });
  }

  private safeParseJSON(str: string): unknown {
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }
}

/**
 * 创建 Anthropic 适配器
 */
export function createAnthropic(config?: AnthropicConfig): AnthropicAdapter {
  return new AnthropicAdapter(config);
}
