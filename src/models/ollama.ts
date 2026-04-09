import type {
  ModelParams,
  ModelCapabilities,
  StreamChunk,
  CompletionResult,
  ContentPart
} from '../core/types.js';
import { BaseModelAdapter, toolsToModelSchema } from './base.js';
import { DEFAULT_ADAPTER_CAPABILITIES } from './default-capabilities.js';
import { debugLogModelRequestBody } from './request-debug.js';

/**
 * Ollama `/api/chat` `think` parameter (see https://docs.ollama.com/capabilities/thinking).
 */
export type OllamaThinkOption = boolean | 'low' | 'medium' | 'high';

/**
 * Ollama 配置
 */
export interface OllamaConfig {
  baseUrl?: string;
  model?: string;
  /** 自定义模型能力 (覆盖默认值) */
  capabilities?: ModelCapabilities;
  /**
   * When set, sent as top-level `think` on `/api/chat`.
   * Omit to use the server default for the model.
   */
  think?: OllamaThinkOption;
}

/**
 * Map one Ollama `/api/chat` stream JSON object to stream chunks (thinking before text).
 * @internal Exported for unit tests.
 */
export function ollamaStreamChunksFromChatData(
  data: Record<string, unknown>,
  parseToolArguments: (args: unknown) => Record<string, unknown>,
  nextToolCallId: () => string
): StreamChunk[] {
  const chunks: StreamChunk[] = [];
  const msg = data.message as Record<string, unknown> | undefined;
  if (!msg) return chunks;

  const thinking = msg.thinking;
  if (typeof thinking === 'string' && thinking.length > 0) {
    chunks.push({ type: 'thinking', content: thinking });
  }

  const content = msg.content;
  if (typeof content === 'string' && content.length > 0) {
    chunks.push({ type: 'text', content });
  }

  const toolCalls = msg.tool_calls as unknown[] | undefined;
  if (toolCalls && Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      const t = tc as Record<string, unknown>;
      const fn = t.function as Record<string, unknown> | undefined;
      chunks.push({
        type: 'tool_call',
        toolCall: {
          id: nextToolCallId(),
          name: (typeof fn?.name === 'string' ? fn.name : '') || '',
          arguments: parseToolArguments(fn?.arguments)
        }
      });
    }
  }

  return chunks;
}

/**
 * Ollama `/api/chat` requires string `content` on each message. The Agent may persist assistant
 * turns as `ContentPart[]` (e.g. thinking + text); replay only `text` parts so the JSON matches
 * Ollama's schema (thinking is not re-sent; the model produces a new trace each request).
 */
export function ollamaMessageContentToApiString(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const texts: string[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      texts.push(part.text);
    }
  }
  return texts.join('\n\n');
}

/** Stable unique id for tool calls in a single adapter response (non-stream complete). */
function uniqueOllamaToolCallId(batchMs: number, index: number): string {
  return `ollama_${batchMs}_${index}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Ollama 模型适配器 (本地模型)
 */
export class OllamaAdapter extends BaseModelAdapter {
  readonly name: string;
  private baseUrl: string;
  private model: string;
  private readonly think: OllamaThinkOption | undefined;

  constructor(config: OllamaConfig = {}) {
    super();
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.model = config.model || 'qwen3.5:0.8b';
    this.think = config.think;

    this.name = `ollama/${this.model}`;

    this.capabilities = config.capabilities ?? DEFAULT_ADAPTER_CAPABILITIES;
  }

  async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(params, true);
    const response = await this.fetch('/api/chat', body, params.signal);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    const nextToolCallId = (): string => `ollama_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

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
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed) as Record<string, unknown>;
            const raw = params.includeRawStreamEvents ? { providerRaw: data as unknown } : {};

            const messageChunks = ollamaStreamChunksFromChatData(
              data,
              (args) => this.parseToolArguments(args),
              nextToolCallId
            );
            for (const chunk of messageChunks) {
              yield { ...chunk, ...raw };
            }

            // 处理完成
            if (data.done) {
              if (data.prompt_eval_count || data.eval_count) {
                yield {
                  type: 'metadata',
                  usagePhase: 'output',
                  metadata: {
                    usage: {
                      promptTokens: (data.prompt_eval_count as number) || 0,
                      completionTokens: (data.eval_count as number) || 0,
                      totalTokens:
                        ((data.prompt_eval_count as number) || 0) + ((data.eval_count as number) || 0)
                    }
                  },
                  ...raw
                };
              }
              yield { type: 'done', ...raw };
            }
          } catch {
            // 跳过解析错误
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async complete(params: ModelParams): Promise<CompletionResult> {
    const body = this.buildRequestBody(params, false);
    const response = await this.fetch('/api/chat', body);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    const result: CompletionResult = {
      content: data.message?.content || ''
    };

    const thinking = data.message?.thinking;
    if (typeof thinking === 'string' && thinking.length > 0) {
      result.thinking = thinking;
    }

    // 处理工具调用（同一毫秒内多条也需唯一 id）
    if (data.message?.tool_calls) {
      const batchMs = Date.now();
      result.toolCalls = data.message.tool_calls.map((tc: any, index: number) => ({
        id: uniqueOllamaToolCallId(batchMs, index),
        name: tc.function?.name || '',
        arguments: this.parseToolArguments(tc.function?.arguments)
      }));
    }

    // 处理使用统计
    if (data.prompt_eval_count || data.eval_count) {
      result.usage = {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
      };
    }

    return result;
  }

  private parseToolArguments(args: unknown): Record<string, unknown> {
    if (args == null) return {};
    if (typeof args === 'object' && !Array.isArray(args)) return args as Record<string, unknown>;
    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args);
        return typeof parsed === 'object' && parsed !== null ? parsed : { value: parsed };
      } catch {
        return {};
      }
    }
    return {};
  }

  /**
   * Ollama 要求 tool_calls.function.arguments 为对象，而非 JSON 字符串。
   * 工具结果消息使用 tool_name（见 https://docs.ollama.com/capabilities/tool-calling ），非 OpenAI 的 tool_call_id。
   */
  protected override transformMessages(messages: ModelParams['messages']): unknown[] {
    const toolCallIdToName = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          toolCallIdToName.set(tc.id, tc.name);
        }
      }
    }

    return messages.map(msg => {
      if (msg.role === 'tool' && msg.toolCallId) {
        const toolName = toolCallIdToName.get(msg.toolCallId) ?? msg.name;
        return {
          role: 'tool' as const,
          content: ollamaMessageContentToApiString(msg.content as string | ContentPart[]),
          ...(toolName && { tool_name: toolName })
        };
      }

      return {
        role: msg.role,
        content: ollamaMessageContentToApiString(msg.content),
        ...(msg.toolCalls && { tool_calls: msg.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: this.parseToolArguments(tc.arguments)
          }
        }))})
      };
    });
  }

  private buildRequestBody(params: ModelParams, stream: boolean): unknown {
    const defaultMaxTokens =
      this.capabilities?.maxOutputTokens ?? DEFAULT_ADAPTER_CAPABILITIES.maxOutputTokens;
    const options: Record<string, unknown> = {
      num_predict: params.maxTokens ?? defaultMaxTokens
    };
    if (params.temperature !== undefined) {
      options.temperature = params.temperature;
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages: this.transformMessages(params.messages),
      stream,
      options
    };

    if (this.think !== undefined) {
      body.think = this.think;
    }

    // 与 OpenAI 一致：每项为 { type: 'function', function: { name, description, parameters } }
    // 参见 https://docs.ollama.com/api/chat ToolDefinition
    if (params.tools && params.tools.length > 0) {
      body.tools = toolsToModelSchema(params.tools).map(tool => ({
        type: 'function' as const,
        function: tool
      }));
    }

    return body;
  }

  private async fetch(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    debugLogModelRequestBody('ollama', path, body);
    return globalThis.fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal
    });
  }
}

/**
 * 创建 Ollama 模型适配器
 */
export function createOllama(config?: OllamaConfig): OllamaAdapter {
  return new OllamaAdapter(config);
}
