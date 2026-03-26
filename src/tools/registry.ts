import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolSchema } from '../core/types.js';
import { zodToJsonSchema } from '../models/base.js';
import { OutputHandler, createOutputHandler } from './output-handler.js';

/**
 * Tool 注册中心配置
 */
export interface ToolRegistryConfig {
  /** 用户基础路径，用于存储超长输出 */
  userBasePath?: string;
  /** 是否启用输出处理（默认 true） */
  enableOutputHandler?: boolean;
}

/**
 * Tool 注册中心
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private categories: Map<string, Set<string>> = new Map();
  private outputHandler: OutputHandler | null;

  constructor(config?: ToolRegistryConfig) {
    const enableOutputHandler = config?.enableOutputHandler !== false;
    this.outputHandler = enableOutputHandler
      ? createOutputHandler(config?.userBasePath)
      : null;
  }

  /**
   * 注册工具
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 注册多个工具
   */
  registerMany(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 注销工具
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 获取工具定义
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具定义
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取工具名称列表
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取工具数量
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * 执行工具
   */
  async execute(name: string, args: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: `Tool "${name}" not found`,
        isError: true
      };
    }

    try {
      // 验证参数
      const validatedArgs = tool.parameters.parse(args);
      const result = await tool.handler(validatedArgs);

      // 输出处理：检查是否需要处理超长输出
      if (this.outputHandler && this.outputHandler.needsHandling(result.content)) {
        return await this.outputHandler.handle(
          result.content,
          name,
          tool.category,
          { args: validatedArgs }
        );
      }

      return result;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          content: `Invalid arguments for tool "${name}": ${error.errors.map(e => e.message).join(', ')}`,
          isError: true
        };
      }
      return {
        content: `Error executing tool "${name}": ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      };
    }
  }

  /**
   * 获取工具 Schema (用于模型调用)
   */
  toSchema(): ToolSchema[] {
    return this.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters) as ToolSchema['parameters']
    }));
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear();
    this.categories.clear();
  }

  /**
   * 按类别注册工具
   */
  registerWithCategory(category: string, tool: ToolDefinition): void {
    this.register(tool);
    
    if (!this.categories.has(category)) {
      this.categories.set(category, new Set());
    }
    this.categories.get(category)!.add(tool.name);
  }

  /**
   * 获取类别下的工具
   */
  getByCategory(category: string): ToolDefinition[] {
    const toolNames = this.categories.get(category);
    if (!toolNames) return [];

    return Array.from(toolNames)
      .map(name => this.tools.get(name))
      .filter((tool): tool is ToolDefinition => tool !== undefined);
  }

  /**
   * 获取所有类别
   */
  getCategories(): string[] {
    return Array.from(this.categories.keys());
  }

  /**
   * 过滤工具
   */
  filter(predicate: (tool: ToolDefinition) => boolean): ToolDefinition[] {
    return this.getAll().filter(predicate);
  }

  /**
   * 搜索工具
   */
  search(query: string): ToolDefinition[] {
    const lowerQuery = query.toLowerCase();
    return this.filter(tool =>
      tool.name.toLowerCase().includes(lowerQuery) ||
      tool.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 导出工具配置
   */
  export(): Array<{ name: string; description: string; parameters: unknown }> {
    return this.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters)
    }));
  }
}

/**
 * 创建工具定义
 */
export function createTool(config: {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  handler: ToolDefinition['handler'];
  isDangerous?: boolean;
  category?: string;
}): ToolDefinition {
  return {
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    handler: config.handler,
    isDangerous: config.isDangerous,
    category: config.category
  };
}

/**
 * 创建全局工具注册中心
 */
let globalRegistry: ToolRegistry | null = null;

export function getGlobalRegistry(): ToolRegistry {
  if (!globalRegistry) {
    globalRegistry = new ToolRegistry();
  }
  return globalRegistry;
}
