import { TOOL_USER_ABORTED_MESSAGE } from '../core/abort-constants.js';
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionPolicy,
  ToolResult,
  ToolSchema
} from '../core/types.js';
import { zodToJsonSchema } from '../models/base.js';
import { OutputHandler, createOutputHandler } from './output-handler.js';
import type { HookManager } from './hooks/manager.js';
import type { HookContext } from './hooks/types.js';
import type { ToolHookObserver } from '../core/callbacks.js';

/**
 * Tool 注册中心配置
 */
export interface ToolRegistryConfig {
  /** 用户基础路径，用于存储超长输出 */
  userBasePath?: string;
  /** 是否启用输出处理（默认 true） */
  enableOutputHandler?: boolean;
  /** 执行前校验（disallowed / allowedTools / canUseTool）；未设置则不限制 */
  executionPolicy?: ToolExecutionPolicy;
  /**
   * 观察 {@link HookManager} 管道（不改变 Hook 行为）。
   * 通常由 {@link Agent} 从 `callbacks.lifecycle.hooks` 注入。
   */
  hookObserver?: ToolHookObserver;
}

/** 工具执行选项（Hook 上下文等） */
export interface ToolExecuteOptions {
  toolCallId?: string;
  projectDir?: string;
  agentDepth?: number;
  /**
   * 若已 aborted，在调用 `handler` 前即返回，且不执行 preToolUse 之后的逻辑。
   * 会传入 {@link ToolExecutionContext.signal}。
   */
  signal?: AbortSignal;
}

/**
 * Tool 注册中心
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private categories: Map<string, Set<string>> = new Map();
  private outputHandler: OutputHandler | null;
  private hookManager: HookManager | null = null;
  private readonly executionPolicy: ToolExecutionPolicy | undefined;
  private readonly hookObserver: ToolHookObserver | undefined;

  constructor(config?: ToolRegistryConfig) {
    const enableOutputHandler = config?.enableOutputHandler !== false;
    this.outputHandler = enableOutputHandler
      ? createOutputHandler(config?.userBasePath)
      : null;
    this.executionPolicy = config?.executionPolicy;
    this.hookObserver = config?.hookObserver;
  }

  /**
   * 工具名是否在 {@link ToolExecutionPolicy.disallowedTools} 中（无策略时为 false）。
   */
  isDisallowed(name: string): boolean {
    return this.executionPolicy?.disallowedTools?.includes(name) ?? false;
  }

  /**
   * `allowedTools` 未设置时视为全部自动批准；已设置时仅列表内自动批准。
   */
  private isAutoApproved(name: string): boolean {
    const allowed = this.executionPolicy?.allowedTools;
    if (allowed === undefined) {
      return true;
    }
    return allowed.includes(name);
  }

  private async checkExecutionPolicy(name: string, args: unknown): Promise<ToolResult | null> {
    const policy = this.executionPolicy;
    if (!policy) {
      return null;
    }

    if (this.isDisallowed(name)) {
      return {
        content: `Tool "${name}" is disallowed by configuration`,
        isError: true
      };
    }

    if (this.isAutoApproved(name)) {
      return null;
    }

    const canUse = policy.canUseTool;
    if (!canUse) {
      return {
        content: `Tool "${name}" requires approval: configure allowedTools or canUseTool`,
        isError: true
      };
    }

    const raw = args;
    const input: Record<string, unknown> =
      raw !== null && raw !== undefined && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const ok = await canUse(name, input);
    if (!ok) {
      return {
        content: `Tool "${name}" was denied by canUseTool`,
        isError: true
      };
    }
    return null;
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

  private hookObserverCtx(
    eventType: HookContext['eventType'],
    name: string,
    options: ToolExecuteOptions | undefined
  ) {
    return {
      eventType,
      toolName: name,
      toolCallId: options?.toolCallId,
      projectDir: options?.projectDir
    };
  }

  /**
   * 注册工具
   */
  register(tool: ToolDefinition): void {
    if (this.isDisallowed(tool.name)) {
      throw new Error(
        `Cannot register tool "${tool.name}": it is listed in disallowedTools`
      );
    }
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

    const policyBlock = await this.checkExecutionPolicy(name, args);
    if (policyBlock) {
      return policyBlock;
    }

    const tool = this.tools.get(name);
    if (!tool) {
      if (hookMgr) {
        this.hookObserver?.onHookStart?.(
          this.hookObserverCtx('postToolUseFailure', name, options)
        );
      }
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
      const initial = tool.parameters.safeParse(args);
      if (!initial.success) {
        const msg = `Invalid arguments for tool "${name}": ${initial.error.issues.map(i => i.message).join(', ')}`;
        if (hookMgr) {
          this.hookObserver?.onHookStart?.(
            this.hookObserverCtx('postToolUseFailure', name, options)
          );
        }
        await hookMgr?.executePostToolUseFailure(
          this.buildHookContext('postToolUseFailure', name, rawArgsObj, options, {
            errorMessage: msg,
            failureKind: 'validation'
          })
        );
        return { content: msg, isError: true };
      }
      workingInput = initial.data as Record<string, unknown>;

      if (options?.signal?.aborted) {
        return { content: TOOL_USER_ABORTED_MESSAGE, isError: true };
      }

      if (hookMgr) {
        this.hookObserver?.onHookStart?.(
          this.hookObserverCtx('preToolUse', name, options)
        );
        const pre = await hookMgr.executePreToolUse(
          this.buildHookContext('preToolUse', name, workingInput, options)
        );
        this.hookObserver?.onHookDecision?.({
          ...this.hookObserverCtx('preToolUse', name, options),
          allowed: pre.allowed,
          reason: pre.reason
        });
        if (!pre.allowed) {
          return {
            content: pre.reason ?? 'Blocked by hook',
            isError: true
          };
        }
        const merged = tool.parameters.safeParse(pre.updatedInput ?? workingInput);
        if (!merged.success) {
          const msg = `Invalid arguments after hook merge for tool "${name}": ${merged.error.issues.map(i => i.message).join(', ')}`;
          this.hookObserver?.onHookStart?.(
            this.hookObserverCtx('postToolUseFailure', name, options)
          );
          await hookMgr.executePostToolUseFailure(
            this.buildHookContext('postToolUseFailure', name, workingInput, options, {
              errorMessage: msg,
              failureKind: 'validation'
            })
          );
          return { content: msg, isError: true };
        }
        workingInput = merged.data as Record<string, unknown>;
      }

      const handlerArgs = workingInput as Parameters<ToolDefinition['handler']>[0];
      const executionContext: ToolExecutionContext = {
        toolCallId: options?.toolCallId,
        projectDir: options?.projectDir,
        agentDepth: options?.agentDepth,
        signal: options?.signal
      };
      const result = await tool.handler(handlerArgs, executionContext);
      const toolResultRaw = result;

      if (result.isError) {
        if (hookMgr) {
          this.hookObserver?.onHookStart?.(
            this.hookObserverCtx('postToolUseFailure', name, options)
          );
        }
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

      if (hookMgr) {
        this.hookObserver?.onHookStart?.(
          this.hookObserverCtx('postToolUse', name, options)
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
      const msg = `Error executing tool "${name}": ${error instanceof Error ? error.message : String(error)}`;
      if (hookMgr) {
        this.hookObserver?.onHookStart?.(
          this.hookObserverCtx('postToolUseFailure', name, options)
        );
      }
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
  parameters: ToolDefinition['parameters'];
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
