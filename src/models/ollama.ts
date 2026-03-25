import type {
  ModelParams,
  ModelCapabilities,
  StreamChunk,
  CompletionResult
} from '../core/types.js';
import { BaseModelAdapter, toolsToModelSchema } from './base.js';

/**
 * Ollama 常见模型能力映射
 */
const OLLAMA_CAPABILITIES: Record<string, ModelCapabilities> = {
  'llama3': { contextLength: 8_192, maxOutputTokens: 2_048 },
  'llama3:70b': { contextLength: 8_192, maxOutputTokens: 2_048 },
  'llama3:8b': { contextLength: 8_192, maxOutputTokens: 2_048 },
  'llama3.1': { contextLength: 131_072, maxOutputTokens: 8_192 },
  'llama3.1:70b': { contextLength: 131_072, maxOutputTokens: 8_192 },
  'llama3.1:8b': { contextLength: 131_072, maxOutputTokens: 8_192 },
  'qwen2': { contextLength: 32_768, maxOutputTokens: 4_096 },
  'qwen2:7b': { contextLength: 32_768, maxOutputTokens: 4_096 },
  'mistral': { contextLength: 32_768, maxOutputTokens: 4_096 },
  'codellama': { contextLength: 16_384, maxOutputTokens: 4_096 },
};

/**
 * Ollama 配置
 */
export interface OllamaConfig {
  baseUrl?: string;
  model?: string;
  /** 自定义模型能力 (覆盖默认值) */
  capabilities?: ModelCapabilities;
}

/**
 * Ollama 模型适配器 (本地模型)
 */
export class OllamaAdapter extends BaseModelAdapter {
  readonly name: string;
  private baseUrl: string;
  private model: string;

  constructor(config: OllamaConfig = {}) {
    super();
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.model = config.model || 'llama3';

    this.name = `ollama/${this.model}`;

    // 设置模型能力 (Ollama 默认使用较小的上下文)
    this.capabilities = config.capabilities
      ?? OLLAMA_CAPABILITIES[this.model]
      ?? { contextLength: 4_096, maxOutputTokens: 2_048 };
  }

  async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(params, true);
    const response = await this.fetch('/api/chat', body);

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

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed);

            // 处理内容
            if (data.message?.content) {
              yield { type: 'text', content: data.message.content };
            }

            // 处理工具调用
            if (data.message?.tool_calls) {
              for (const tc of data.message.tool_calls) {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: `ollama_${Date.now()}`,
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || {}
                  }
                };
              }
            }

            // 处理完成
            if (data.done) {
              if (data.prompt_eval_count || data.eval_count) {
                yield {
                  type: 'metadata',
                  metadata: {
                    usage: {
                      promptTokens: data.prompt_eval_count || 0,
                      completionTokens: data.eval_count || 0,
                      totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
                    }
                  }
                };
              }
              yield { type: 'done' };
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

    // 处理工具调用
    if (data.message?.tool_calls) {
      result.toolCalls = data.message.tool_calls.map((tc: any) => ({
        id: `ollama_${Date.now()}`,
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || {}
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

  private buildRequestBody(params: ModelParams, stream: boolean): unknown {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: this.transformMessages(params.messages),
      stream,
      ...(params.temperature !== undefined && { options: { temperature: params.temperature } })
    };

    // 添加工具
    if (params.tools && params.tools.length > 0) {
      body.tools = toolsToModelSchema(params.tools);
    }

    return body;
  }

  private async fetch(path: string, body: unknown): Promise<Response> {
    return globalThis.fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  }
}

/**
 * 创建 Ollama 适配器
 */
export function createOllama(config?: OllamaConfig): OllamaAdapter {
  return new OllamaAdapter(config);
}
