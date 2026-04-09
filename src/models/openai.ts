import type {
  ModelParams,
  ModelCapabilities,
  StreamChunk,
  CompletionResult
} from '../core/types.js';
import { BaseModelAdapter, toolsToModelSchema } from './base.js';
import { DEFAULT_ADAPTER_CAPABILITIES } from './default-capabilities.js';
import { debugLogModelRequestBody } from './request-debug.js';

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

    this.capabilities = config.capabilities ?? DEFAULT_ADAPTER_CAPABILITIES;
  }

  async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(params, true);
    const response = await this.fetch('/chat/completions', body, params.signal);

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
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));
            const choice = data.choices?.[0];
            if (!choice) continue;
            const raw = params.includeRawStreamEvents ? { providerRaw: data as unknown } : {};

            // 处理内容增量
            if (choice.delta?.content) {
              yield { type: 'text', content: choice.delta.content, ...raw };
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
                        },
                        ...raw
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
                      toolCallId: toolCall.id,
                      ...raw
                    };
                  } else if (toolCall.function?.arguments && currentToolCall) {
                    currentToolCall.arguments += toolCall.function.arguments;
                    yield {
                      type: 'tool_call_delta',
                      content: toolCall.function.arguments,
                      toolCallId: currentToolCall.id,
                      ...raw
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
                },
                ...raw
              };
              currentToolCall = null;
            }

            // 处理元数据
            if (data.usage) {
              yield {
                type: 'metadata',
                usagePhase: 'output',
                metadata: {
                  usage: {
                    promptTokens: data.usage.prompt_tokens,
                    completionTokens: data.usage.completion_tokens,
                    totalTokens: data.usage.total_tokens
                  }
                },
                ...raw
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
          },
          ...(params.includeRawStreamEvents ? { providerRaw: { trailing: true } } : {})
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
    const defaultMaxTokens =
      this.capabilities?.maxOutputTokens ?? DEFAULT_ADAPTER_CAPABILITIES.maxOutputTokens;
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream,
      ...(stream && { stream_options: { include_usage: true } }),
      ...(params.temperature !== undefined && { temperature: params.temperature }),
      max_tokens: params.maxTokens ?? defaultMaxTokens,
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

  private async fetch(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    debugLogModelRequestBody('openai', path, body);
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
 * 创建 OpenAI 适配器
 */
export function createOpenAI(config?: OpenAIConfig): OpenAIAdapter {
  return new OpenAIAdapter(config);
}
