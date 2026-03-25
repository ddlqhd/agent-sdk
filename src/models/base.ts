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

/**
 * 将 Zod Schema 转换为 JSON Schema
 */
export function zodToJsonSchema(schema: z.ZodSchema): unknown {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodFieldToJsonSchema(value as z.ZodSchema);
      if (!(value as z.ZodSchema).isOptional()) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined
    };
  }

  return zodFieldToJsonSchema(schema);
}

/**
 * 将单个 Zod 字段转换为 JSON Schema
 */
function zodFieldToJsonSchema(schema: z.ZodSchema): unknown {
  if (schema instanceof z.ZodString) {
    return { type: 'string', description: schema.description };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: 'number', description: schema.description };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean', description: schema.description };
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodFieldToJsonSchema(schema.element),
      description: schema.description
    };
  }
  if (schema instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: schema.options,
      description: schema.description
    };
  }
  if (schema instanceof z.ZodOptional) {
    return zodFieldToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodNullable) {
    return zodFieldToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodObject) {
    return zodToJsonSchema(schema);
  }

  return { type: 'string' };
}

/**
 * 将工具定义转换为模型工具 Schema
 */
export function toolsToModelSchema(tools: ToolDefinition[]): ToolSchema[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.parameters) as ToolSchema['parameters']
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
 * 基础模型适配器抽象类
 */
export abstract class BaseModelAdapter implements ModelAdapter {
  abstract readonly name: string;

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
