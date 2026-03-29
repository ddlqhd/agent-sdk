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
      required: required.length > 0 ? required : undefined,
      additionalProperties: false
    };
  }

  return zodFieldToJsonSchema(schema);
}

/**
 * 将单个 Zod 字段转换为 JSON Schema
 */
function zodFieldToJsonSchema(schema: z.ZodSchema): unknown {
  // ZodDefault → unwrap inner type and extract default value
  if ((schema as any)._def?.typeName === 'ZodDefault') {
    const inner = zodFieldToJsonSchema((schema as any)._def.innerType);
    const defaultValue = (schema as any)._def.defaultValue();
    const desc = schema.description || (inner as Record<string, unknown>)?.description;
    const result: Record<string, unknown> = { ...(inner as Record<string, unknown>) };
    if (desc) result.description = desc;
    result.default = defaultValue;
    return result;
  }

  // ZodOptional → unwrap, preserve description from wrapper
  if (schema instanceof z.ZodOptional) {
    const inner = zodFieldToJsonSchema(schema.unwrap());
    const desc = schema.description || (inner as Record<string, unknown>)?.description;
    if (desc && (inner as Record<string, unknown>)?.description !== desc) {
      return { ...(inner as Record<string, unknown>), description: desc };
    }
    return inner;
  }

  // ZodNullable → unwrap, preserve description
  if (schema instanceof z.ZodNullable) {
    const inner = zodFieldToJsonSchema(schema.unwrap());
    const desc = schema.description || (inner as Record<string, unknown>)?.description;
    if (desc && (inner as Record<string, unknown>)?.description !== desc) {
      return { ...(inner as Record<string, unknown>), description: desc };
    }
    return inner;
  }

  // ZodString → add minLength/maxLength from checks
  if (schema instanceof z.ZodString) {
    const result: Record<string, unknown> = { type: 'string' };
    if (schema.description) result.description = schema.description;
    for (const check of (schema as any)._def.checks) {
      if (check.kind === 'min') result.minLength = check.value;
      if (check.kind === 'max') result.maxLength = check.value;
    }
    return result;
  }

  // ZodNumber → add int/minimum/maximum from checks
  if (schema instanceof z.ZodNumber) {
    const result: Record<string, unknown> = { type: 'number' };
    if (schema.description) result.description = schema.description;
    for (const check of (schema as any)._def.checks) {
      if (check.kind === 'int') result.type = 'integer';
      if (check.kind === 'min') {
        if (check.inclusive === false) result.exclusiveMinimum = check.value;
        else result.minimum = check.value;
      }
      if (check.kind === 'max') {
        if (check.inclusive === false) result.exclusiveMaximum = check.value;
        else result.maximum = check.value;
      }
    }
    return result;
  }

  // ZodBoolean
  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean', description: schema.description };
  }

  // ZodArray → add minItems/maxItems
  if (schema instanceof z.ZodArray) {
    const result: Record<string, unknown> = {
      type: 'array',
      items: zodFieldToJsonSchema(schema.element)
    };
    if (schema.description) result.description = schema.description;
    if ((schema as any)._def.minLength) result.minItems = (schema as any)._def.minLength.value;
    if ((schema as any)._def.maxLength) result.maxItems = (schema as any)._def.maxLength.value;
    return result;
  }

  // ZodEnum
  if (schema instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: schema.options,
      description: schema.description
    };
  }

  // Nested ZodObject
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
