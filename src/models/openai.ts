import type {
  ModelParams,
  ModelCapabilities,
  StreamChunk,
  CompletionResult
} from '../core/types.js';
import { BaseModelAdapter, toolsToModelSchema } from './base.js';
import { DEFAULT_ADAPTER_CAPABILITIES } from './default-capabilities.js';
import {
  logModelRequestEnd,
  logModelRequestFailure,
  logModelRequestStart,
  logModelStreamParseError
} from './model-request-log.js';

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
  /**
   * vLLM-style OpenAI-compat: sets `chat_template_kwargs.enable_thinking`.
   * Stream and complete parsers accept `reasoning` and legacy `reasoning_content`.
   */
  thinking?: boolean;
  /** 浅合并进请求 JSON 末尾，可覆盖上述字段与其它默认项。 */
  extraBody?: Record<string, unknown>;
}

/**
 * OpenAI 模型适配器
 */
export class OpenAIAdapter extends BaseModelAdapter {
  get name(): string {
    return `openai/${this.model}`;
  }
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private organization?: string;
  private readonly thinkingToggle?: boolean;
  private readonly extraBody?: Record<string, unknown>;

  constructor(config: OpenAIConfig = {}) {
    super();
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = config.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    this.model = config.model || 'gpt-4o';
    this.organization = config.organization || process.env.OPENAI_ORG_ID;
    this.thinkingToggle = config.thinking;
    this.extraBody = config.extraBody;

    if (!this.apiKey) {
      throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass apiKey in config.');
    }

    this.capabilities = config.capabilities ?? DEFAULT_ADAPTER_CAPABILITIES;
  }

  clone(): OpenAIAdapter {
    return new OpenAIAdapter({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      model: this.model,
      organization: this.organization,
      capabilities: this.capabilities,
      thinking: this.thinkingToggle,
      extraBody: this.extraBody
    });
  }

  setModel(modelId: string): void {
    const t = modelId.trim();
    if (!t) {
      throw new Error('OpenAIAdapter.setModel: model id must be non-empty');
    }
    this.model = t;
  }

  async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(params, true);
    const response = await this.fetch('/chat/completions', body, 'stream', params);

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
    let reasoningBlockOpen = false;
    // 兼容服务（vLLM/SGLang 等）会在每个 SSE chunk 上回传 cumulative `usage`；标准 OpenAI 仅在最末尾
    // `choices: []` 的 chunk 上回传一次。统一在流结束时只 yield 一次最新的 usage，避免下游：
    // 1) CLI 把 📊 Tokens 行夹在 thinking/text 增量之间反复打印；
    // 2) `Agent` 累计 sessionUsage 时把 cumulative 输入按 chunk 数倍数累加。
    let pendingUsage:
      | { promptTokens: number; completionTokens: number; totalTokens: number }
      | undefined;
    let pendingUsageRaw: unknown | undefined;

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
            const raw = params.includeRawStreamEvents ? { providerRaw: data as unknown } : {};

            // 即便本 chunk 没有 choice（如标准 OpenAI 的最末尾 usage-only chunk），仍要捕获 usage。
            if (data.usage) {
              pendingUsage = {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens
              };
              if (params.includeRawStreamEvents) {
                pendingUsageRaw = data;
              }
            }

            const choice = data.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta ?? {};

            // vLLM / 兼容网关：推理增量（thinking 语义）
            const reasoningDelta =
              (typeof delta.reasoning === 'string' && delta.reasoning) ||
              (typeof delta.reasoning_content === 'string' && delta.reasoning_content);
            if (reasoningDelta) {
              reasoningBlockOpen = true;
              yield { type: 'thinking', content: reasoningDelta, ...raw };
            }

            if (choice.finish_reason && reasoningBlockOpen) {
              yield { type: 'thinking_block_end', ...raw };
              reasoningBlockOpen = false;
            }

            // 处理内容增量（正文开始前结束推理块）
            if (delta.content) {
              if (reasoningBlockOpen) {
                yield { type: 'thinking_block_end', ...raw };
                reasoningBlockOpen = false;
              }
              yield { type: 'text', content: delta.content, ...raw };
            }

            // 处理工具调用
            if (choice.delta?.tool_calls) {
              if (reasoningBlockOpen) {
                yield { type: 'thinking_block_end', ...raw };
                reasoningBlockOpen = false;
              }
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
          } catch (error) {
            logModelStreamParseError(
              {
                provider: 'openai',
                model: this.model,
                path: '/chat/completions',
                operation: 'stream',
                params
              },
              trimmed,
              error
            );
          }
        }
      }

      // 末尾仍悬空的推理块
      if (reasoningBlockOpen) {
        reasoningBlockOpen = false;
        yield {
          type: 'thinking_block_end',
          ...(params.includeRawStreamEvents ? { providerRaw: { trailing: true } } : {})
        };
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

      // 在流末尾一次性 yield 最新的 cumulative usage（标准 OpenAI 与兼容服务统一行为）。
      if (pendingUsage) {
        yield {
          type: 'metadata',
          usagePhase: 'output',
          metadata: { usage: pendingUsage },
          ...(pendingUsageRaw !== undefined ? { providerRaw: pendingUsageRaw } : {})
        };
      }

      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }

  async complete(params: ModelParams): Promise<CompletionResult> {
    const body = this.buildRequestBody(params, false);
    const response = await this.fetch('/chat/completions', body, 'complete', params);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('No completion choice returned');
    }

    const msg = choice.message ?? {};
    const result: CompletionResult = {
      content: msg.content ?? ''
    };

    const reasoningStr =
      (typeof msg.reasoning === 'string' && msg.reasoning) ||
      (typeof msg.reasoning_content === 'string' && msg.reasoning_content) ||
      '';
    if (reasoningStr.length > 0) {
      result.thinking = reasoningStr;
    }

    // 处理工具调用
    if (msg.tool_calls) {
      result.toolCalls = msg.tool_calls.map((tc: any) => ({
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

    if (this.thinkingToggle !== undefined) {
      body.chat_template_kwargs = { enable_thinking: this.thinkingToggle };
    }

    if (this.extraBody) {
      Object.assign(body, this.extraBody);
    }

    return body;
  }

  private async fetch(
    path: string,
    body: unknown,
    operation: 'stream' | 'complete',
    params: ModelParams
  ): Promise<Response> {
    const requestLog = logModelRequestStart({
      provider: 'openai',
      model: this.model,
      path,
      operation,
      params
    }, body);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'X-Client-Request-Id': requestLog.clientRequestId
    };

    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization;
    }
    try {
      const response = await globalThis.fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: params.signal
      });
      logModelRequestEnd(
        {
          provider: 'openai',
          model: this.model,
          path,
          operation,
          params
        },
        requestLog,
        response
      );
      return response;
    } catch (error) {
      logModelRequestFailure(
        {
          provider: 'openai',
          model: this.model,
          path,
          operation,
          params
        },
        requestLog,
        error
      );
      throw error;
    }
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
