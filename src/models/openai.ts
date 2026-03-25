import type {
  ModelParams,
  ModelCapabilities,
  StreamChunk,
  CompletionResult
} from '../core/types.js';
import { BaseModelAdapter, toolsToModelSchema } from './base.js';

/**
 * OpenAI 模型能力映射
 */
const OPENAI_CAPABILITIES: Record<string, ModelCapabilities> = {
  'gpt-4o': { contextLength: 128_000, maxOutputTokens: 16_384 },
  'gpt-4o-mini': { contextLength: 128_000, maxOutputTokens: 16_384 },
  'gpt-4-turbo': { contextLength: 128_000, maxOutputTokens: 4_096 },
  'gpt-4': { contextLength: 8_192, maxOutputTokens: 4_096 },
  'gpt-3.5-turbo': { contextLength: 16_385, maxOutputTokens: 4_096 },
};

/**
 * OpenAI 配置
 */
export interface OpenAIConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  organization?: string;
  /** 自定义模型能力 (覆盖默认值) */
  capabilities?: ModelCapabilities;
}

/**
 * OpenAI 模型适配器
 */
export class OpenAIAdapter extends BaseModelAdapter {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private organization?: string;

  constructor(config: OpenAIConfig = {}) {
    super();
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = config.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    this.model = config.model || 'gpt-4o';
    this.organization = config.organization || process.env.OPENAI_ORG_ID;

    if (!this.apiKey) {
      throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass apiKey in config.');
    }

    this.name = `openai/${this.model}`;

    // 设置模型能力
    this.capabilities = config.capabilities
      ?? OPENAI_CAPABILITIES[this.model]
      ?? { contextLength: 128_000, maxOutputTokens: 4_096 };
  }

  async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(params, true);
    const response = await this.fetch('/chat/completions', body);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall: { id: string; name: string; arguments: string } | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));
            const choice = data.choices?.[0];
            if (!choice) continue;

            // 处理内容增量
            if (choice.delta?.content) {
              yield { type: 'text', content: choice.delta.content };
            }

            // 处理工具调用
            if (choice.delta?.tool_calls) {
              for (const toolCall of choice.delta.tool_calls) {
                if (toolCall.index !== undefined) {
                  // 新的工具调用开始
                  if (toolCall.id && toolCall.function?.name) {
                    if (currentToolCall) {
                      yield {
                        type: 'tool_call',
                        toolCall: {
                          id: currentToolCall.id,
                          name: currentToolCall.name,
                          arguments: this.safeParseJSON(currentToolCall.arguments)
                        }
                      };
                    }
                    currentToolCall = {
                      id: toolCall.id,
                      name: toolCall.function.name,
                      arguments: toolCall.function.arguments || ''
                    };
                    yield {
                      type: 'tool_call_start',
                      content: toolCall.function.name,
                      toolCallId: toolCall.id
                    };
                  } else if (toolCall.function?.arguments && currentToolCall) {
                    currentToolCall.arguments += toolCall.function.arguments;
                    yield {
                      type: 'tool_call_delta',
                      content: toolCall.function.arguments,
                      toolCallId: currentToolCall.id
                    };
                  }
                }
              }
            }

            // 处理完成
            if (choice.finish_reason === 'tool_calls' && currentToolCall) {
              yield {
                type: 'tool_call',
                toolCall: {
                  id: currentToolCall.id,
                  name: currentToolCall.name,
                  arguments: this.safeParseJSON(currentToolCall.arguments)
                }
              };
              currentToolCall = null;
            }

            // 处理元数据
            if (data.usage) {
              yield {
                type: 'metadata',
                metadata: {
                  usage: {
                    promptTokens: data.usage.prompt_tokens,
                    completionTokens: data.usage.completion_tokens,
                    totalTokens: data.usage.total_tokens
                  }
                }
              };
            }
          } catch {
            // 跳过解析错误
          }
        }
      }

      // 处理剩余的工具调用
      if (currentToolCall) {
        yield {
          type: 'tool_call',
          toolCall: {
            id: currentToolCall.id,
            name: currentToolCall.name,
            arguments: this.safeParseJSON(currentToolCall.arguments)
          }
        };
      }

      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }

  async complete(params: ModelParams): Promise<CompletionResult> {
    const body = this.buildRequestBody(params, false);
    const response = await this.fetch('/chat/completions', body);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('No completion choice returned');
    }

    const result: CompletionResult = {
      content: choice.message?.content || ''
    };

    // 处理工具调用
    if (choice.message?.tool_calls) {
      result.toolCalls = choice.message.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: this.safeParseJSON(tc.function.arguments)
      }));
    }

    // 处理使用统计
    if (data.usage) {
      result.usage = {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      };
    }

    return result;
  }

  private buildRequestBody(params: ModelParams, stream: boolean): unknown {
    const messages = this.transformMessages(params.messages);
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream,
      ...(stream && { stream_options: { include_usage: true } }),
      ...(params.temperature !== undefined && { temperature: params.temperature }),
      ...(params.maxTokens !== undefined && { max_tokens: params.maxTokens }),
      ...(params.stopSequences && { stop: params.stopSequences })
    };

    // 添加工具
    if (params.tools && params.tools.length > 0) {
      body.tools = toolsToModelSchema(params.tools).map(tool => ({
        type: 'function',
        function: tool
      }));
    }

    return body;
  }

  private async fetch(path: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };

    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization;
    }

    return globalThis.fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
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
 * 创建 OpenAI 适配器
 */
export function createOpenAI(config?: OpenAIConfig): OpenAIAdapter {
  return new OpenAIAdapter(config);
}
