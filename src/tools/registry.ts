import { z } from 'zod';
import type { ToolDefinition, ToolExecutionContext, ToolResult, ToolSchema } from '../core/types.js';
import { zodToJsonSchema } from '../models/base.js';
import { OutputHandler, createOutputHandler } from './output-handler.js';
import type { HookManager } from './hooks/manager.js';
import type { HookContext } from './hooks/types.js';

/**
 * Tool 注册中心配置
 */
export interface ToolRegistryConfig {
  /** 用户基础路径，用于存储超长输出 */
  userBasePath?: string;
  /** 是否启用输出处理（默认 true） */
  enableOutputHandler?: boolean;
}

/** 工具执行选项（Hook 上下文等） */
export interface ToolExecuteOptions {
  toolCallId?: string;
  projectDir?: string;
  agentDepth?: number;
}

/**
 * Tool 注册中心
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private categories: Map<string, Set<string>> = new Map();
  private outputHandler: OutputHandler | null;
  private hookManager: HookManager | null = null;

  constructor(config?: ToolRegistryConfig) {
    const enableOutputHandler = config?.enableOutputHandler !== false;
    this.outputHandler = enableOutputHandler
      ? createOutputHandler(config?.userBasePath)
      : null;
  }

  setHookManager(manager: HookManager | null): void {
    this.hookManager = manager;
  }

  getHookManager(): HookManager | null {
    return this.hookManager;
  }

  private buildHookContext(
    event: HookContext['eventType'],
    name: string,
    toolInput: Record<string, unknown>,
    options: ToolExecuteOptions | undefined,
    extra: Partial<HookContext> = {}
  ): HookContext {
    return {
      eventType: event,
      toolName: name,
      toolInput,
      timestamp: Date.now(),
      projectDir: options?.projectDir,
      toolCallId: options?.toolCallId,
      ...extra
    };
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
  async execute(name: string, args: unknown, options?: ToolExecuteOptions): Promise<ToolResult> {
    const hookMgr = this.hookManager;
    const rawArgsObj =
      typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};

    const tool = this.tools.get(name);
    if (!tool) {
      const ctx = this.buildHookContext('postToolUseFailure', name, rawArgsObj, options, {
        errorMessage: `Tool "${name}" not found`,
        failureKind: 'tool_error'
      });
      await hookMgr?.executePostToolUseFailure(ctx);
      return {
        content: `Tool "${name}" not found`,
        isError: true
      };
    }

    let workingInput: Record<string, unknown> = rawArgsObj;
    try {
      workingInput = tool.parameters.parse(args) as Record<string, unknown>;

      if (hookMgr) {
        const pre = await hookMgr.executePreToolUse(
          this.buildHookContext('preToolUse', name, workingInput, options)
        );
        if (!pre.allowed) {
          return {
            content: pre.reason ?? 'Blocked by hook',
            isError: true
          };
        }
        try {
          workingInput = tool.parameters.parse(pre.updatedInput ?? workingInput) as Record<
            string,
            unknown
          >;
        } catch (err) {
          if (err instanceof z.ZodError) {
            const msg = `Invalid arguments after hook merge for tool "${name}": ${err.errors.map(e => e.message).join(', ')}`;
            await hookMgr.executePostToolUseFailure(
              this.buildHookContext('postToolUseFailure', name, workingInput, options, {
                errorMessage: msg,
                failureKind: 'validation'
              })
            );
            return { content: msg, isError: true };
          }
          throw err;
        }
      }

      const handlerArgs = workingInput as Parameters<ToolDefinition['handler']>[0];
      const executionContext: ToolExecutionContext = {
        toolCallId: options?.toolCallId,
        projectDir: options?.projectDir,
        agentDepth: options?.agentDepth
      };
      const result = await tool.handler(handlerArgs, executionContext);
      const toolResultRaw = result;

      if (result.isError) {
        await hookMgr?.executePostToolUseFailure(
          this.buildHookContext('postToolUseFailure', name, workingInput, options, {
            errorMessage: result.content,
            failureKind: 'tool_error'
          })
        );
        return result;
      }

      let finalResult = result;
      if (this.outputHandler && this.outputHandler.needsHandling(result.content)) {
        finalResult = await this.outputHandler.handle(
          result.content,
          name,
          tool.category,
          { args: handlerArgs }
        );
      }

      await hookMgr?.executePostToolUse(
        this.buildHookContext('postToolUse', name, workingInput, options, {
          toolResultRaw,
          toolResultFinal: finalResult
        })
      );

      return finalResult;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const msg = `Invalid arguments for tool "${name}": ${error.errors.map(e => e.message).join(', ')}`;
        await hookMgr?.executePostToolUseFailure(
          this.buildHookContext('postToolUseFailure', name, rawArgsObj, options, {
            errorMessage: msg,
            failureKind: 'validation'
          })
        );
        return {
          content: msg,
          isError: true
        };
      }
      const msg = `Error executing tool "${name}": ${error instanceof Error ? error.message : String(error)}`;
      await hookMgr?.executePostToolUseFailure(
        this.buildHookContext('postToolUseFailure', name, workingInput, options, {
          errorMessage: msg,
          failureKind: 'handler_throw'
        })
      );
      return {
        content: msg,
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
      parameters: zodToJsonSchema(tool.parameters) as Record<string, unknown>
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
