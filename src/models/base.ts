import { z } from 'zod';
import type {
  ModelAdapter,
  ModelCapabilities,
  ModelParams,
  StreamChunk,
  CompletionResult,
  ToolDefinition,
  ToolSchema,
  TokenUsage
} from '../core/types.js';

/** Options passed through to Zod’s JSON Schema conversion (target, io, etc.). */
export type ZodToJsonSchemaOptions = NonNullable<Parameters<typeof z.toJSONSchema>[1]>;

/**
 * 将 Zod Schema 转换为 JSON Schema（使用 Zod 4 内置转换，避免跨副本 instanceof 失效）
 */
export function zodToJsonSchema(
  schema: z.ZodType,
  options?: ZodToJsonSchemaOptions
): unknown {
  return z.toJSONSchema(schema, options);
}

/**
 * 将工具定义转换为模型工具 Schema
 */
export function toolsToModelSchema(tools: ToolDefinition[]): ToolSchema[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.parameters) as Record<string, unknown>
  }));
}

/**
 * 合并 Token 使用统计
 */
export function mergeTokenUsage(...usages: (TokenUsage | undefined)[]): TokenUsage {
  const merged: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  };

  for (const usage of usages) {
    if (usage) {
      merged.promptTokens += usage.promptTokens;
      merged.completionTokens += usage.completionTokens;
      merged.totalTokens += usage.totalTokens;
    }
  }

  return merged;
}

/**
 * Strip trailing slashes from an API base URL so path joins do not produce `//` segments
 * (OpenRouter and some gateways return 404 for e.g. `/api/v1//chat/completions`).
 */
export function normalizeApiBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** Join API base URL and path with a single slash boundary. */
export function joinApiUrl(baseUrl: string, path: string): string {
  const base = normalizeApiBaseUrl(baseUrl);
  const segment = path.startsWith('/') ? path : `/${path}`;
  return `${base}${segment}`;
}

/**
 * 基础模型适配器抽象类。具体提供商适配器应实现 {@link ModelAdapter.clone} / {@link ModelAdapter.setModel}
 * 以便子 Agent 等在换模时保留与父级一致的密钥与高级配置（见内置 OpenAI / Anthropic / Ollama）。
 */
export abstract class BaseModelAdapter implements ModelAdapter {
  abstract get name(): string;

  /** 模型能力描述 */
  capabilities?: ModelCapabilities;

  abstract stream(params: ModelParams): AsyncIterable<StreamChunk>;
  abstract complete(params: ModelParams): Promise<CompletionResult>;

  /**
   * 转换消息格式
   */
  protected transformMessages(messages: ModelParams['messages']): unknown[] {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      ...(msg.toolCalls && { tool_calls: msg.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: typeof tc.arguments === 'string'
            ? tc.arguments
            : JSON.stringify(tc.arguments)
        }
      }))}),
      ...(msg.toolCallId && { tool_call_id: msg.toolCallId })
    }));
  }
}
