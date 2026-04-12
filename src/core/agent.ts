import {
  isModelStreamEventType,
  type ToolCall,
  type TokenUsage,
  type SessionTokenUsage,
  type AgentConfig,
  type AgentResult,
  type StreamEvent,
  type SystemPrompt,
  type MCPServerConfig,
  type ContextManagerConfig,
  type Message,
  type ModelAdapter,
  type ToolResult,
  type AgentErrorContext,
  type AgentRunEndReason
} from '../core/types.js';
import { randomUUID } from 'crypto';
import { ToolRegistry } from '../tools/registry.js';
import { getAllBuiltinTools } from '../tools/builtin/index.js';
import { SessionManager } from '../storage/session.js';
import { getSessionStoragePath } from '../storage/session-path.js';
import { DEFAULT_SYSTEM_PROMPT } from './prompts.js';
import { MemoryManager } from '../memory/manager.js';
import { getEnvironmentInfo, formatEnvironmentSection } from './environment.js';
import { MCPAdapter } from '../mcp/adapter.js';
import { formatMcpToolName, isMcpPrefixedToolName } from '../mcp/mcp-tool-name.js';
import { SkillRegistry, createSkillRegistry } from '../skills/registry.js';
import { createSkillTemplateProcessor } from '../skills/template.js';
import type { SkillTemplateContext } from '../skills/template.js';
import { ContextManager } from './context-manager.js';
import { emitSDKLog } from './logger.js';
import { HookManager } from '../tools/hooks/manager.js';
import { StreamChunkProcessor } from '../streaming/chunk-processor.js';
import {
  createAgentTool,
  resolveSubagentTypeAppend,
  subagentExploreDefaultsUnavailableMessage,
  SUBAGENT_EXPLORE_DEFAULT_TOOL_NAMES,
  type SubagentRequest,
  type SubagentType
} from '../tools/builtin/subagent.js';
import { mergeMcpStdioEnv } from './process-env-merge.js';
import { createModel } from '../models/index.js';
import { SummarizationCompressor } from './compressor.js';

/** Default upper bound for model↔tool rounds per user turn when `AgentConfig.maxIterations` is omitted. */
export const DEFAULT_MAX_ITERATIONS = 400;

/**
 * 流式执行选项
 */
export interface StreamOptions {
  sessionId?: string;
  systemPrompt?: SystemPrompt;
  signal?: AbortSignal;
  /** Pass through to {@link ModelParams.includeRawStreamEvents} (e.g. Anthropic `providerRaw` on chunks). */
  includeRawStreamEvents?: boolean;
}

/**
 * Agent 类
 * 核心执行引擎，管理对话循环和工具调用
 */
export class Agent {
  private config: AgentConfig;
  private toolRegistry: ToolRegistry;
  private sessionManager: SessionManager;
  private messages: Message[] = [];
  private mcpAdapter: MCPAdapter | null = null;
  private skillRegistry: SkillRegistry;
  private initPromise: Promise<void>;
  private contextManager: ContextManager | null = null;
  private hookDiscoverPromise: Promise<void> | null = null;
  private agentDepth = 0;
  private activeSubagentRuns = 0;

  // Token 使用量统计
  // contextTokens: 当前上下文大小 (用于压缩判断)
  // inputTokens/outputTokens: 累计消耗
  // totalTokens: 累计总消耗 (inputTokens + outputTokens)
  private sessionUsage: SessionTokenUsage = Agent.createEmptySessionUsage();

  private static resolveModel(config: AgentConfig): ModelAdapter {
    if (config.model) {
      if (config.modelConfig) {
        throw new Error('AgentConfig: pass only one of `model` or `modelConfig`');
      }
      return config.model;
    }
    if (config.modelConfig) {
      return createModel(config.modelConfig, config.env);
    }
    throw new Error('AgentConfig: `model` or `modelConfig` is required');
  }

  constructor(config: AgentConfig) {
    const resolvedModel = Agent.resolveModel(config);
    this.config = {
      maxIterations: DEFAULT_MAX_ITERATIONS,
      streaming: true,
      ...config,
      model: resolvedModel,
      modelConfig: undefined
    };
    this.config.maxIterations = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;


    // 初始化 Skill 注册中心
    this.skillRegistry = createSkillRegistry({
      cwd: this.config.cwd,
      userBasePath: this.config.userBasePath
    });

    // 初始化工具注册中心（执行策略与 AgentConfig 对齐，便于在 ToolRegistry.execute 中统一校验）
    this.toolRegistry = new ToolRegistry({
      executionPolicy: {
        disallowedTools: this.config.disallowedTools,
        allowedTools: this.config.allowedTools,
        canUseTool: this.config.canUseTool
      },
      hookObserver: this.config.callbacks?.lifecycle?.hooks
    });

    this.registerInitialTools();

    const subagentEnabled = this.config.subagent?.enabled !== false;
    if (subagentEnabled) {
      if (this.toolRegistry.has('Agent')) {
        this.toolRegistry.unregister('Agent');
      }
      this.toolRegistry.register(createAgentTool({
        runner: (request, context) => this.runSubagent(request, context)
      }));
    } else if (this.toolRegistry.has('Agent')) {
      this.toolRegistry.unregister('Agent');
    }

    if (this.config.hookManager) {
      this.toolRegistry.setHookManager(this.config.hookManager);
    } else {
      const allowFileHooks =
        this.config.loadHookSettingsFromFiles !== false ||
        this.config.hookConfigDir !== undefined;
      if (allowFileHooks) {
        const hm = HookManager.create();
        this.toolRegistry.setHookManager(hm);
        const projectDir = this.config.hookConfigDir ?? this.config.cwd ?? process.cwd();
        this.hookDiscoverPromise = hm.discoverAndLoad(projectDir, this.config.userBasePath);
      }
    }

    // 初始化会话管理器（存储在用户目录下）
    this.sessionManager = new SessionManager({
      type: this.config.storage?.type || 'jsonl',
      basePath: getSessionStoragePath(this.config.userBasePath)
    });

    // 初始化 ContextManager
    if (this.config.contextManagement !== false) {
      const cmConfig: ContextManagerConfig = this.config.contextManagement === true
        ? {}
        : this.config.contextManagement ?? {};

      const compressor = cmConfig.compressor ?? new SummarizationCompressor(this.config.model!, {
        logger: this.config.logger,
        logLevel: this.config.logLevel,
        redaction: this.config.redaction,
        sessionIdProvider: () => this.sessionManager.sessionId ?? undefined
      });
      this.contextManager = new ContextManager(this.config.model!, {
        ...cmConfig,
        compressor
      });
    }

    // 启动异步初始化，保存 Promise 供外部等待
    this.initPromise = this.initializeAsync();
  }

  private log(
    level: 'debug' | 'info' | 'warn' | 'error',
    event: Parameters<typeof emitSDKLog>[0]['event']
  ): void {
    emitSDKLog({
      logger: this.config.logger,
      logLevel: this.config.logLevel,
      level,
      event
    });
  }

  /**
   * 注册内置 + 自定义工具，或仅 {@link AgentConfig.exclusiveTools}。
   */
  private registerInitialTools(): void {
    if (this.config.exclusiveTools !== undefined) {
      for (const tool of this.config.exclusiveTools) {
        if (this.toolRegistry.isDisallowed(tool.name)) {
          continue;
        }
        this.toolRegistry.register(tool);
      }
      return;
    }

    const builtins = getAllBuiltinTools(this.skillRegistry, {
      resolve: this.config.askUserQuestion
    }).filter(t => !this.toolRegistry.isDisallowed(t.name));

    this.toolRegistry.registerMany(builtins);

    for (const tool of this.config.tools ?? []) {
      if (this.toolRegistry.isDisallowed(tool.name)) {
        continue;
      }
      if (this.toolRegistry.has(tool.name)) {
        this.toolRegistry.unregister(tool.name);
      }
      this.toolRegistry.register(tool);
    }
  }

  /**
   * 异步初始化（skills 和 MCP）
   */
  private async initializeAsync(): Promise<void> {
    try {
      if (this.hookDiscoverPromise) {
        await this.hookDiscoverPromise;
      }

      // 初始化 skills（默认路径 + 配置路径）
      await this.skillRegistry.initialize(
        this.config.skillConfig,
        this.config.skills
      );

      // 初始化 MCP 适配器
      if (this.config.mcpServers && this.config.mcpServers.length > 0) {
        this.mcpAdapter = new MCPAdapter();
        await this.initializeMCP(this.config.mcpServers);
      }
    } catch (err) {
      // 初始化失败不应阻塞 Agent 使用，只输出警告
      const error = err instanceof Error ? err : new Error(String(err));
      this.log('error', {
        component: 'agent',
        event: 'agent.initialize.error',
        message: 'Failed to initialize agent resources',
        errorName: error.name,
        errorMessage: error.message
      });
    }
  }

  /**
   * 等待初始化完成
   * CLI 应在开始交互前调用此方法
   */
  async waitForInit(): Promise<void> {
    await this.initPromise;
  }

  /**
   * 初始化 MCP 服务器
   */
  private async initializeMCP(servers: MCPServerConfig[]): Promise<void> {
    if (!this.mcpAdapter) return;

    for (const serverConfig of servers) {
      try {
        await this.connectMCP(serverConfig);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.log('error', {
          component: 'tooling',
          event: 'mcp.connect.error',
          message: `Failed to connect MCP server "${serverConfig.name}"`,
          errorName: error.name,
          errorMessage: error.message,
          metadata: {
            serverName: serverConfig.name
          }
        });
      }
    }
  }

  private annotateStreamEvent(event: StreamEvent, iteration?: number): StreamEvent {
    return {
      ...event,
      streamEventId: randomUUID(),
      ...(iteration !== undefined ? { iteration } : {}),
      sessionId: this.sessionManager.sessionId ?? undefined
    } as StreamEvent;
  }

  private baseRunContext(): { sessionId?: string; cwd?: string } {
    return {
      sessionId: this.sessionManager.sessionId ?? undefined,
      cwd: this.config.cwd
    };
  }

  /**
   * 分发流式事件到 `callbacks.onEvent` 与 `lifecycle.onModelEvent` / `onModelUsage`。
   */
  private emitStreamEvent(event: StreamEvent): void {
    try {
      this.config.callbacks?.onEvent?.(event);
      const lifecycle = this.config.callbacks?.lifecycle;
      if (lifecycle?.onModelEvent && isModelStreamEventType(event.type)) {
        lifecycle.onModelEvent(event);
      }
      if (event.type === 'model_usage' && lifecycle?.onModelUsage) {
        lifecycle.onModelUsage({
          ...this.baseRunContext(),
          usage: event.usage,
          iteration: event.iteration,
          phase: event.phase
        });
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.emitAgentError(e, { phase: 'lifecycle_callback' });
    }
  }

  /** 标注、触发观察回调并返回供 `yield` 的事件 */
  private streamOut(event: StreamEvent, iteration?: number): StreamEvent {
    const out =
      iteration !== undefined ? this.annotateStreamEvent(event, iteration) : this.annotateStreamEvent(event);
    this.emitStreamEvent(out);
    return out;
  }

  private emitAgentError(error: Error, ctx: AgentErrorContext): void {
    try {
      this.config.callbacks?.lifecycle?.onAgentError?.(error, ctx);
      this.config.callbacks?.onError?.(error, ctx);
    } catch (err) {
      this.log('error', {
        component: 'agent',
        event: 'agent.callback.error',
        message: 'Agent error callback threw',
        errorName: err instanceof Error ? err.name : 'Error',
        errorMessage: err instanceof Error ? err.message : String(err)
      });
    }
  }

  private safeLifecycleVoid(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.emitAgentError(e, { phase: 'lifecycle_callback' });
    }
  }

  private emitRunEnd(args: {
    reason: AgentRunEndReason;
    iterations: number;
    usage?: TokenUsage;
    error?: Error;
  }): void {
    this.safeLifecycleVoid(() => {
      this.config.callbacks?.lifecycle?.onRunEnd?.({
        ...this.baseRunContext(),
        reason: args.reason,
        iterations: args.iterations,
        usage: args.usage,
        error: args.error
      });
    });
  }

  private static createEmptySessionUsage(): SessionTokenUsage {
    return {
      contextTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0
    };
  }

  private resetSessionState(): void {
    this.messages = [];
    this.sessionUsage = this.contextManager
      ? this.contextManager.resetUsage()
      : Agent.createEmptySessionUsage();
  }

  /**
   * 构建系统提示词
   * 处理默认提示词、替换模式、追加模式
   */
  private buildSystemPrompt(customPrompt?: SystemPrompt): string {
    // 判断是否需要包含环境信息
    // 优先级：customPrompt.includeEnvironment > config.includeEnvironment > true
    const shouldIncludeEnv = typeof customPrompt === 'object'
      ? customPrompt.includeEnvironment !== false
      : this.config.includeEnvironment !== false;

    // 生成环境信息部分
    let envSection = '';
    if (shouldIncludeEnv) {
      const cwd = this.config.cwd || process.cwd();
      const envInfo = getEnvironmentInfo(cwd);
      envSection = formatEnvironmentSection(envInfo);
    }

    // 没有自定义提示词
    if (!customPrompt) {
      let basePrompt = DEFAULT_SYSTEM_PROMPT;
      basePrompt = basePrompt.replace('{{SKILL_LIST}}', this.skillRegistry.getFormattedList());
      return basePrompt + envSection;
    }

    // 字符串形式：追加模式
    if (typeof customPrompt === 'string') {
      let basePrompt = DEFAULT_SYSTEM_PROMPT;
      basePrompt = basePrompt.replace('{{SKILL_LIST}}', this.skillRegistry.getFormattedList());
      return `${basePrompt}${envSection}\n\n${customPrompt}`;
    }

    // 配置对象
    const { content, mode = 'append' } = customPrompt;

    if (mode === 'replace') {
      // 替换模式：使用自定义内容 + 环境信息
      return content + envSection;
    } else {
      // 追加模式：默认提示词 + 环境信息 + 自定义内容
      let basePrompt = DEFAULT_SYSTEM_PROMPT;
      basePrompt = basePrompt.replace('{{SKILL_LIST}}', this.skillRegistry.getFormattedList());
      return `${basePrompt}${envSection}\n\n${content}`;
    }
  }

  /**
   * 流式执行
   */
  async *stream(input: string, options?: StreamOptions): AsyncIterable<StreamEvent> {
    const signal = options?.signal;

    // 恢复或创建会话
    if (options?.sessionId) {
      const isSwitchingSession = this.sessionManager.sessionId !== options.sessionId;
      if (isSwitchingSession) {
        this.resetSessionState();
      }
      try {
        this.messages = await this.sessionManager.resumeSession(options.sessionId);
        this.safeLifecycleVoid(() => {
          this.config.callbacks?.lifecycle?.onSessionResume?.({
            sessionId: options.sessionId!,
            messageCount: this.messages.length
          });
        });
      } catch {
        // 目标会话不存在时，创建新会话并保持已重置的空状态
        this.sessionManager.createSession(options.sessionId);
        this.safeLifecycleVoid(() => {
          this.config.callbacks?.lifecycle?.onSessionCreate?.({
            sessionId: this.sessionManager.sessionId ?? undefined
          });
        });
      }
    } else if (!this.sessionManager.sessionId) {
      this.resetSessionState();
      this.sessionManager.createSession();
      this.safeLifecycleVoid(() => {
        this.config.callbacks?.lifecycle?.onSessionCreate?.({
          sessionId: this.sessionManager.sessionId ?? undefined
        });
      });
    }

    // 添加系统提示
    if (this.messages.length === 0) {
      const usedRuntimePrompt = options?.systemPrompt !== undefined;
      const systemPrompt = this.buildSystemPrompt(
        options?.systemPrompt || this.config.systemPrompt
      );
      const sysMsg: Message = {
        role: 'system',
        content: systemPrompt
      };
      this.messages.push(sysMsg);
      this.safeLifecycleVoid(() => {
        this.config.callbacks?.lifecycle?.onSystemMessage?.(
          sysMsg,
          usedRuntimePrompt ? 'runtime_prompt' : 'default_prompt',
          this.baseRunContext()
        );
      });
    }

    // 加载长期记忆（作为独立的 system message）
    // 检查是否应该加载记忆：
    // 1. 记忆功能已启用
    // 2. 这是新用户消息（会话中没有用户消息）
    if (this.config.memory !== false) {
      const hasUserMessages = this.messages.some(m => m.role === 'user');

      // 只有当还没有用户消息时才加载记忆
      // 这样可以确保记忆只被加载一次，并且是在对话开始时
      if (!hasUserMessages) {
        const memoryManager = new MemoryManager(this.config.cwd, this.config.memoryConfig, this.config.userBasePath);
        const memoryContent = memoryManager.loadMemory();

        if (memoryContent) {
          const memMsg: Message = {
            role: 'system',
            content: memoryContent
          };
          this.messages.push(memMsg);
          this.safeLifecycleVoid(() => {
            this.config.callbacks?.lifecycle?.onSystemMessage?.(memMsg, 'memory', this.baseRunContext());
          });
        }
      }
    }

    // 处理 skill 调用
    let processedInput = input;
    const processed = await this.processInput(input);
    if (processed.invoked) {
      processedInput = processed.prompt;
    }

    const userMsg: Message = {
      role: 'user',
      content: processedInput
    };
    this.messages.push(userMsg);
    this.safeLifecycleVoid(() => {
      this.config.callbacks?.lifecycle?.onUserMessage?.(
        userMsg,
        processed.invoked ? 'processed_input' : 'raw_input',
        this.baseRunContext()
      );
    });

    this.log('info', {
      component: 'agent',
      event: 'agent.run.start',
      message: 'Starting agent turn',
      sessionId: this.sessionManager.sessionId ?? undefined,
      metadata: {
        inputLength: input.length,
        processedInputLength: processedInput.length,
        includeRawStreamEvents: options?.includeRawStreamEvents === true
      }
    });

    this.safeLifecycleVoid(() => {
      this.config.callbacks?.lifecycle?.onRunStart?.({
        ...this.baseRunContext(),
        inputLength: input.length,
        processedInputLength: processedInput.length,
        resumeSessionId: options?.sessionId
      });
    });

    yield this.streamOut({ type: 'start', timestamp: Date.now() });

    try {
      const maxIterations = Math.max(1, this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS);
      let totalUsage: TokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      };

      let iteration = 0;
      for (; iteration < maxIterations; iteration++) {
        if (signal?.aborted) {
          this.log('info', {
            component: 'agent',
            event: 'agent.run.aborted',
            message: 'Agent turn aborted before model request',
            sessionId: this.sessionManager.sessionId ?? undefined,
            iteration
          });
          this.emitRunEnd({ reason: 'aborted', iterations: iteration, usage: totalUsage });
          this.safeLifecycleVoid(() => {
            this.config.callbacks?.lifecycle?.onRunAbort?.({ ...this.baseRunContext(), iteration });
          });
          yield this.streamOut(
            {
              type: 'end',
              usage: totalUsage,
              timestamp: Date.now(),
              reason: 'aborted'
            },
            iteration
          );
          return;
        }

        this.log('debug', {
          component: 'agent',
          event: 'agent.iteration.start',
          message: 'Starting agent iteration',
          sessionId: this.sessionManager.sessionId ?? undefined,
          iteration,
          metadata: {
            messageCount: this.messages.length,
            toolCount: this.toolRegistry.getAll().length
          }
        });

        this.safeLifecycleVoid(() => {
          this.config.callbacks?.lifecycle?.onIterationStart?.({
            ...this.baseRunContext(),
            iteration,
            messageCount: this.messages.length,
            toolCount: this.toolRegistry.getAll().length
          });
        });

        // 上下文压缩检查
        const contextEvents = await this.checkContextCompression();
        for (const event of contextEvents) {
          if (event.type === 'context_compressed') {
            this.safeLifecycleVoid(() => {
              this.config.callbacks?.lifecycle?.onContextCompressed?.({
                ...this.baseRunContext(),
                iteration,
                stats: event.stats
              });
            });
          }
          yield this.streamOut(event, iteration);
        }

        this.safeLifecycleVoid(() => {
          this.config.callbacks?.lifecycle?.onModelRequestStart?.({
            ...this.baseRunContext(),
            iteration,
            messageCount: this.messages.length,
            toolCount: this.toolRegistry.getAll().length,
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens,
            includeRawStreamEvents: options?.includeRawStreamEvents
          });
        });

        const modelParams = {
          messages: this.messages,
          tools: this.toolRegistry.getAll(),
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          signal,
          includeRawStreamEvents: options?.includeRawStreamEvents,
          sessionId: this.sessionManager.sessionId ?? undefined,
          logger: this.config.logger,
          logLevel: this.config.logLevel,
          redaction: this.config.redaction
        };

        const stream = this.config.model!.stream(modelParams);
        let hasToolCalls = false;
        const toolCalls: ToolCall[] = [];
        let assistantContent = '';
        let thinkingContent = '';
        let thinkingSignature: string | undefined;
        const chunkProcessor = new StreamChunkProcessor({ emitTextBoundaries: true });

        const applyStreamOut = (out: StreamEvent): void => {
          if (out.type === 'text_delta') {
            assistantContent += out.content;
          }
          if (out.type === 'thinking') {
            thinkingContent += out.content;
            if (out.signature !== undefined && !thinkingSignature) {
              thinkingSignature = out.signature;
            }
          }
          if (out.type === 'tool_call') {
            hasToolCalls = true;
            toolCalls.push({
              id: out.id,
              name: out.name,
              arguments: out.arguments
            });
          }
          if (out.type === 'model_usage') {
            const usage = out.usage;
            if (usage.promptTokens > 0) {
              totalUsage.promptTokens = usage.promptTokens;
              this.sessionUsage.contextTokens = usage.promptTokens;
              this.sessionUsage.inputTokens += usage.promptTokens;
            }
            totalUsage.completionTokens += usage.completionTokens;
            totalUsage.totalTokens = totalUsage.promptTokens + totalUsage.completionTokens;
            this.sessionUsage.outputTokens += usage.completionTokens;
          }
        };

        let fatalModelError = false;
        for await (const chunk of stream) {
          if (signal?.aborted) {
            for (const event of chunkProcessor.flush()) {
              const out = this.streamOut(event, iteration);
              yield out;
              applyStreamOut(out);
            }
            if (assistantContent) {
              const assistantMessage: Message = {
                role: 'assistant',
                content: assistantContent
              };
              if (thinkingContent) {
                assistantMessage.content = [
                  { type: 'thinking', thinking: thinkingContent, signature: thinkingSignature || '' },
                  { type: 'text', text: assistantContent }
                ];
              }
              this.messages.push(assistantMessage);
              this.safeLifecycleVoid(() => {
                this.config.callbacks?.lifecycle?.onAssistantMessage?.(assistantMessage, {
                  ...this.baseRunContext(),
                  iteration
                });
              });
            }

            const interruptMsg: Message = {
              role: 'user',
              content: '[User interrupted the response]'
            };
            this.messages.push(interruptMsg);
            this.safeLifecycleVoid(() => {
              this.config.callbacks?.lifecycle?.onUserMessage?.(
                interruptMsg,
                'interruption_marker',
                this.baseRunContext()
              );
            });

            await this.sessionManager.saveMessages(this.messages);
            this.safeLifecycleVoid(() => {
              this.config.callbacks?.lifecycle?.onMessagePersist?.({
                ...this.baseRunContext(),
                messageCount: this.messages.length
              });
            });

            this.emitRunEnd({ reason: 'aborted', iterations: iteration + 1, usage: totalUsage });
            this.safeLifecycleVoid(() => {
              this.config.callbacks?.lifecycle?.onRunAbort?.({ ...this.baseRunContext(), iteration });
            });

            yield this.streamOut(
              {
                type: 'end',
                usage: totalUsage,
                timestamp: Date.now(),
                reason: 'aborted',
                partialContent: assistantContent
              },
              iteration
            );
            return;
          }

          const events = chunkProcessor.processChunk(chunk);
          for (const event of events) {
            const out = this.streamOut(event, iteration);
            yield out;
            applyStreamOut(out);
            if (out.type === 'end' && out.reason === 'error' && out.error) {
              this.emitAgentError(out.error, { phase: 'model', iteration });
              this.safeLifecycleVoid(() => {
                this.config.callbacks?.lifecycle?.onModelRequestError?.(out.error!, {
                  phase: 'model',
                  iteration
                });
              });
            }
            if (out.type === 'end' && out.reason === 'error') {
              fatalModelError = true;
              break;
            }
          }
          if (fatalModelError) {
            break;
          }
        }

        if (fatalModelError) {
          return;
        }

        for (const event of chunkProcessor.flush()) {
          const out = this.streamOut(event, iteration);
          yield out;
          applyStreamOut(out);
        }

        this.safeLifecycleVoid(() => {
          this.config.callbacks?.lifecycle?.onModelRequestEnd?.({ ...this.baseRunContext(), iteration });
        });

        const assistantMessage: Message = {
          role: 'assistant',
          content: assistantContent
        };

        if (thinkingContent) {
          const contentParts: any[] = [
            {
              type: 'thinking',
              thinking: thinkingContent,
              signature: thinkingSignature
            }
          ];
          if (assistantContent.trim()) {
            contentParts.push({ type: 'text', text: assistantContent });
          }
          assistantMessage.content = contentParts;
        }

        if (toolCalls.length > 0) {
          assistantMessage.toolCalls = toolCalls;
        }

        this.messages.push(assistantMessage);
        this.safeLifecycleVoid(() => {
          this.config.callbacks?.lifecycle?.onAssistantMessage?.(assistantMessage, {
            ...this.baseRunContext(),
            iteration
          });
        });

        if (!hasToolCalls) {
          this.log('debug', {
            component: 'agent',
            event: 'agent.iteration.end',
            message: 'Iteration completed without tool calls',
            sessionId: this.sessionManager.sessionId ?? undefined,
            iteration,
            metadata: {
              assistantContentLength: assistantContent.length
            }
          });
          this.safeLifecycleVoid(() => {
            this.config.callbacks?.lifecycle?.onIterationEnd?.({
              ...this.baseRunContext(),
              iteration,
              hadToolCalls: false
            });
          });
          break;
        }

        const toolResults = await this.executeTools(toolCalls, iteration);

        for (const result of toolResults) {
          if (result.isError && result.error) {
            yield this.streamOut(
              {
                type: 'tool_error',
                toolCallId: result.toolCallId,
                error: result.error
              },
              iteration
            );
          }
          yield this.streamOut(
            {
              type: 'tool_result',
              toolCallId: result.toolCallId,
              result: result.content
            },
            iteration
          );

          const toolMsg: Message = {
            role: 'tool',
            toolCallId: result.toolCallId,
            content: result.content
          };
          this.messages.push(toolMsg);
          this.safeLifecycleVoid(() => {
            this.config.callbacks?.lifecycle?.onToolMessage?.(toolMsg, {
              ...this.baseRunContext(),
              iteration,
              toolCallId: result.toolCallId
            });
          });
        }

        this.log('debug', {
          component: 'agent',
          event: 'agent.iteration.end',
          message: 'Iteration completed with tool calls',
          sessionId: this.sessionManager.sessionId ?? undefined,
          iteration,
          metadata: {
            toolCallCount: toolCalls.length,
            toolResultCount: toolResults.length
          }
        });
        this.safeLifecycleVoid(() => {
          this.config.callbacks?.lifecycle?.onIterationEnd?.({
            ...this.baseRunContext(),
            iteration,
            hadToolCalls: true
          });
        });
      }

      await this.sessionManager.saveMessages(this.messages);
      this.safeLifecycleVoid(() => {
        this.config.callbacks?.lifecycle?.onMessagePersist?.({
          ...this.baseRunContext(),
          messageCount: this.messages.length
        });
      });

      const finishedByIterationCap = iteration >= maxIterations;
      const sessionIterations = finishedByIterationCap ? maxIterations : iteration + 1;

      yield this.streamOut({
        type: 'session_summary',
        usage: totalUsage,
        iterations: sessionIterations
      });

      this.emitRunEnd({
        reason: finishedByIterationCap ? 'max_iterations' : 'complete',
        iterations: sessionIterations,
        usage: totalUsage
      });
      yield this.streamOut({
        type: 'end',
        timestamp: Date.now(),
        reason: finishedByIterationCap ? 'max_iterations' : 'complete'
      });
      this.log('info', {
        component: 'agent',
        event: 'agent.run.end',
        message: finishedByIterationCap ? 'Agent turn stopped at max iterations' : 'Agent turn completed',
        sessionId: this.sessionManager.sessionId ?? undefined,
        metadata: {
          iterations: sessionIterations,
          promptTokens: totalUsage.promptTokens,
          completionTokens: totalUsage.completionTokens,
          totalTokens: totalUsage.totalTokens
        }
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        this.log('info', {
          component: 'agent',
          event: 'agent.run.aborted',
          message: 'Agent turn aborted',
          sessionId: this.sessionManager.sessionId ?? undefined
        });
        this.emitRunEnd({ reason: 'aborted', iterations: 0 });
        this.safeLifecycleVoid(() => {
          this.config.callbacks?.lifecycle?.onRunAbort?.({ ...this.baseRunContext() });
        });
        yield this.streamOut({
          type: 'end',
          timestamp: Date.now(),
          reason: 'aborted'
        });
        return;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      this.log('error', {
        component: 'agent',
        event: 'agent.run.error',
        message: 'Agent turn failed',
        sessionId: this.sessionManager.sessionId ?? undefined,
        errorName: err.name,
        errorMessage: err.message
      });
      this.emitAgentError(err, { phase: 'run' });
      this.emitRunEnd({ reason: 'error', iterations: 0, error: err });
      yield this.streamOut({
        type: 'end',
        timestamp: Date.now(),
        reason: 'error',
        error: err
      });
    }
  }

  /**
   * 非流式执行
   */
  async run(input: string, options?: StreamOptions): Promise<AgentResult> {
    let content = '';
    const toolCalls: Array<{
      name: string;
      arguments: unknown;
      result: string;
    }> = [];
    let usage: TokenUsage | undefined;
    let iterations = 0;
    let streamError: Error | undefined;

    for await (const event of this.stream(input, options)) {
      if (event.type === 'text_delta') {
        content += event.content;
      }

      if (event.type === 'tool_result') {
        const matchingCall = this.messages
          .filter(m => m.role === 'assistant' && m.toolCalls)
          .flatMap(m => m.toolCalls!)
          .find(tc => tc.id === event.toolCallId);

        if (matchingCall) {
          toolCalls.push({
            name: matchingCall.name,
            arguments: matchingCall.arguments,
            result: event.result
          });
        }
      }

      if (event.type === 'model_usage') {
        usage = event.usage;
      }

      if (event.type === 'session_summary') {
        usage = event.usage;
        iterations = event.iterations;
      }

      if (event.type === 'end') {
        if (event.usage !== undefined) {
          usage = event.usage;
        }
        if (event.reason === 'error' && event.error) {
          streamError = event.error;
        }
      }
    }

    if (streamError) {
      throw streamError;
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      sessionId: this.sessionManager.sessionId!,
      iterations
    };
  }

  /**
   * 注册工具
   */
  registerTool(tool: Parameters<ToolRegistry['register']>[0]): void {
    this.toolRegistry.register(tool);
  }

  /**
   * 注册多个工具
   */
  registerTools(tools: Parameters<ToolRegistry['registerMany']>[0]): void {
    for (const t of tools) {
      this.registerTool(t);
    }
  }

  /**
   * 获取工具注册中心
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * 获取会话管理器
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * 加载 Skill
   */
  async loadSkill(path: string): Promise<void> {
    await this.skillRegistry.load(path);
  }

  /**
   * 获取 Skill 注册中心
   */
  getSkillRegistry(): SkillRegistry {
    return this.skillRegistry;
  }

  /**
   * 解析后的模型适配器（`modelConfig` 已在构造时合并 `env` 并实例化）。
   */
  getModel(): ModelAdapter {
    return this.config.model!;
  }

  /**
   * 处理用户输入，检测并处理 skill 调用
   * @param input 用户输入
   * @returns 处理结果
   */
  async processInput(input: string): Promise<{
    invoked: boolean;
    skillName?: string;
    prompt: string;
  }> {
    const invocation = this.parseSkillInvocation(input);

    if (!invocation) {
      return { invoked: false, prompt: input };
    }

    const { name, args } = invocation;

    try {
      const prompt = await this.invokeSkill(name, args);
      return { invoked: true, skillName: name, prompt };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        invoked: false,
        prompt: `Error invoking skill "${name}": ${errorMsg}\n\nOriginal input: ${input}`
      };
    }
  }

  /**
   * 调用 skill 并返回处理后的 prompt
   * @param name Skill 名称
   * @param args 参数字符串
   * @returns 处理后的 prompt
   */
  async invokeSkill(name: string, args: string = ''): Promise<string> {
    const skill = this.skillRegistry.get(name);

    if (!skill) {
      const available = this.skillRegistry.getNames();
      throw new Error(
        `Skill "${name}" not found. Available skills: ${available.join(', ') || 'none'}`
      );
    }

    // 检查 skill 是否可以被用户调用
    if (skill.metadata.userInvocable === false) {
      throw new Error(`Skill "${name}" is not user-invocable`);
    }

    // 获取 skill 内容
    const content = await this.skillRegistry.loadFullContent(name);

    // 创建模板处理器
    const context: SkillTemplateContext = {
      skillDir: skill.path || '',
      sessionId: this.sessionManager.sessionId || undefined,
      cwd: this.config.cwd
    };
    const processor = createSkillTemplateProcessor(context);

    // 处理模板
    let processedContent = await processor.process(content, args);

    // 如果内容中没有 $ARGUMENTS 但有参数，追加到末尾
    if (args && !content.includes('$ARGUMENTS') && !content.includes('$0')) {
      processedContent += `\n\nARGUMENTS: ${args}`;
    }

    return processedContent;
  }

  /**
   * 解析 skill 调用格式
   * 格式: /skill-name [args]
   * @param input 用户输入
   * @returns 解析结果或 null
   */
  private parseSkillInvocation(input: string): { name: string; args: string } | null {
    const trimmed = input.trim();

    // 必须以 / 开头
    if (!trimmed.startsWith('/')) {
      return null;
    }

    // 提取 skill 名称和参数（支持中文等任意非空白字符）
    const match = trimmed.match(/^\/([^\s\/]+)(?:\s+(.*))?$/);

    if (!match) {
      return null;
    }

    const name = match[1];
    const args = match[2] || '';

    // 检查 skill 是否存在
    if (!this.skillRegistry.has(name)) {
      return null;
    }

    return { name, args };
  }

  /**
   * 连接 MCP 服务器
   */
  async connectMCP(config: MCPServerConfig): Promise<void> {
    if (!this.mcpAdapter) {
      this.mcpAdapter = new MCPAdapter();
    }

    const resolved: MCPServerConfig =
      config.transport === 'stdio'
        ? {
            ...config,
            env: mergeMcpStdioEnv(this.config.env, config.env),
            cwd: (config.cwd ?? '').trim() || (this.config.cwd || process.cwd())
          }
        : config;

    await this.mcpAdapter.addServer(resolved);

    const mcpTools = this.mcpAdapter.getToolDefinitions();
    const serverPrefix = formatMcpToolName(config.name, '');
    for (const tool of mcpTools) {
      if (!tool.name.startsWith(serverPrefix)) {
        continue;
      }
      if (this.toolRegistry.isDisallowed(tool.name)) {
        continue;
      }
      this.toolRegistry.register(tool);
    }
  }

  /**
   * 断开指定 MCP 服务器
   */
  async disconnectMCP(name: string): Promise<void> {
    if (!this.mcpAdapter) return;

    // 获取要移除的工具列表
    const tools = this.toolRegistry.getAll();
    for (const tool of tools) {
      if (tool.name.startsWith(formatMcpToolName(name, ''))) {
        this.toolRegistry.unregister(tool.name);
      }
    }

    // 断开服务器连接
    await this.mcpAdapter.removeServer(name);
  }

  /**
   * 断开所有 MCP 服务器
   */
  async disconnectAllMCP(): Promise<void> {
    if (!this.mcpAdapter) return;

    // 移除所有 MCP 工具
    const tools = this.toolRegistry.getAll();
    for (const tool of tools) {
      if (isMcpPrefixedToolName(tool.name)) {
        this.toolRegistry.unregister(tool.name);
      }
    }

    // 断开所有连接
    await this.mcpAdapter.disconnectAll();
    this.mcpAdapter = null;
  }

  /**
   * 获取 MCP 适配器
   */
  getMCPAdapter(): MCPAdapter | null {
    return this.mcpAdapter;
  }

  /**
   * 销毁 Agent，清理资源
   */
  async destroy(): Promise<void> {
    await this.disconnectAllMCP();
    this.messages = [];
  }

  /**
   * 获取消息历史
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * 清空消息历史
   */
  clearMessages(): void {
    this.resetSessionState();
  }

  /**
   * 设置系统提示 (运行时替换)
   */
  setSystemPrompt(prompt: SystemPrompt): void {
    // 移除旧的系统提示
    this.messages = this.messages.filter(m => m.role !== 'system');

    // 构建新的系统提示
    const systemPrompt = this.buildSystemPrompt(prompt);

    // 添加新的系统提示
    if (this.messages.length > 0) {
      this.messages.unshift({
        role: 'system',
        content: systemPrompt
      });
    }
  }

  /**
   * 追加系统提示内容
   */
  appendSystemPrompt(additionalContent: string): void {
    // 查找现有的系统提示
    const systemMessageIndex = this.messages.findIndex(m => m.role === 'system');

    if (systemMessageIndex >= 0) {
      // 追加到现有系统提示
      this.messages[systemMessageIndex].content += `\n\n${additionalContent}`;
    } else {
      // 如果没有系统提示，创建一个新的
      const systemPrompt = this.buildSystemPrompt(additionalContent);
      this.messages.unshift({
        role: 'system',
        content: systemPrompt
      });
    }
  }

  /**
   * 获取当前系统提示内容
   */
  getSystemPrompt(): string | undefined {
    const systemMessage = this.messages.find(m => m.role === 'system');
    if (!systemMessage) return undefined;
    // 系统消息的 content 一定是 string
    return typeof systemMessage.content === 'string'
      ? systemMessage.content
      : undefined;
  }

  /**
   * 手动触发上下文压缩
   */
  async compressContext(): Promise<{
    messageCount: number;
    stats: { originalMessageCount: number; compressedMessageCount: number; durationMs: number };
  }> {
    if (!this.contextManager) {
      throw new Error('Context management is disabled');
    }

    const result = await this.contextManager.compress(this.messages);
    this.messages = result.messages;
    this.sessionUsage = this.contextManager.resetUsage();

    // 保存压缩后的会话
    await this.sessionManager.saveMessages(this.messages);

    return {
      messageCount: this.messages.length,
      stats: result.stats
    };
  }

  /**
   * 获取上下文状态
   */
  getContextStatus(): {
    used: number;
    usable: number;
    needsCompaction: boolean;
    compressCount: number;
  } | null {
    if (!this.contextManager) {
      return null;
    }

    return this.contextManager.getStatus(this.sessionUsage);
  }

  /**
   * 获取会话累计 Token 使用量
   */
  getSessionUsage(): SessionTokenUsage {
    // 实时计算 totalTokens = 累计输入 + 累计输出
    return {
      ...this.sessionUsage,
      totalTokens: this.sessionUsage.inputTokens + this.sessionUsage.outputTokens
    };
  }

  /**
   * 检查并执行上下文压缩
   * @returns 压缩事件数组（可能为空）
   */
  private async checkContextCompression(): Promise<StreamEvent[]> {
    if (!this.contextManager) {
      return [];
    }

    // 先执行 prune 清理旧工具输出
    this.messages = this.contextManager.prune(this.messages);

    // 检查是否需要压缩
    if (!this.contextManager.shouldCompress(this.sessionUsage)) {
      return [];
    }

    const result = await this.contextManager.compress(this.messages);
    this.messages = result.messages;
    this.sessionUsage = this.contextManager.resetUsage();

    return [
      {
        type: 'context_compressed',
        stats: result.stats
      }
    ];
  }

  private getSubagentConfig() {
    return {
      enabled: this.config.subagent?.enabled !== false,
      maxDepth: this.config.subagent?.maxDepth ?? 1,
      maxParallel: this.config.subagent?.maxParallel ?? 5,
      timeoutMs: this.config.subagent?.timeoutMs ?? 120000,
      allowDangerousTools: this.config.subagent?.allowDangerousTools ?? false,
      defaultAllowedTools: this.config.subagent?.defaultAllowedTools
    };
  }

  private resolveSubagentTools(
    request: SubagentRequest,
    subagentType: SubagentType
  ): {
    tools?: ReturnType<ToolRegistry['getAll']>;
    error?: string;
  } {
    const subagentConfig = this.getSubagentConfig();
    const parentTools = this.toolRegistry.getAll();
    const byName = new Map(parentTools.map(tool => [tool.name, tool] as const));

    let requestedNames = request.allowed_tools ?? subagentConfig.defaultAllowedTools;

    let usedExploreDefaultNames = false;
    if (requestedNames === undefined && subagentType === 'explore') {
      requestedNames = [...SUBAGENT_EXPLORE_DEFAULT_TOOL_NAMES];
      usedExploreDefaultNames = true;
    }

    let selected = requestedNames
      ? requestedNames
          .map(name => byName.get(name))
          .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined)
      : parentTools.filter(tool => !tool.isDangerous);

    if (usedExploreDefaultNames && selected.length === 0) {
      return { error: subagentExploreDefaultsUnavailableMessage() };
    }

    selected = selected.filter(tool => tool.name !== 'Agent');
    selected = selected.filter(tool => tool.name !== 'AskUserQuestion');

    if (!subagentConfig.allowDangerousTools) {
      const requestedDangerous = request.allowed_tools?.some(name => byName.get(name)?.isDangerous);
      if (requestedDangerous) {
        return {
          error: 'Subagent dangerous tools are disabled by configuration'
        };
      }
      selected = selected.filter(tool => !tool.isDangerous);
    }

    if (selected.length === 0) {
      return { error: 'No tools available for subagent after filtering' };
    }

    return { tools: selected };
  }

  private async runSubagent(
    request: SubagentRequest,
    context?: { agentDepth?: number }
  ): Promise<{
    content: string;
    isError?: boolean;
    metadata?: Record<string, unknown>;
  }> {
    const subagentConfig = this.getSubagentConfig();
    const currentDepth = context?.agentDepth ?? this.agentDepth;

    if (!subagentConfig.enabled) {
      return { content: 'Subagent is disabled by configuration', isError: true };
    }
    if (currentDepth >= subagentConfig.maxDepth) {
      return { content: 'Subagent cannot spawn subagents', isError: true };
    }
    if (this.activeSubagentRuns >= subagentConfig.maxParallel) {
      return { content: 'Subagent concurrency limit reached', isError: true };
    }

    const normalizedType = request.subagent_type ?? 'general-purpose';
    const requestedTimeout = request.timeout_ms ?? subagentConfig.timeoutMs;
    const timeoutMs = Math.min(requestedTimeout, subagentConfig.timeoutMs);
    const maxIterations = Math.max(
      1,
      request.max_iterations ?? this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS
    );

    const resolved = this.resolveSubagentTools(request, normalizedType);
    if (!resolved.tools) {
      return {
        content: resolved.error ?? 'Unable to resolve subagent tools',
        isError: true
      };
    }

    const childConfig: AgentConfig = {
      ...this.config,
      hookManager: this.config.hookManager ?? this.toolRegistry.getHookManager() ?? undefined,
      exclusiveTools: resolved.tools,
      tools: undefined,
      mcpServers: undefined,
      maxIterations,
      subagent: {
        ...this.config.subagent,
        enabled: false
      }
    };

    const child = new Agent(childConfig);
    child.agentDepth = currentDepth + 1;
    const startedAt = Date.now();
    this.activeSubagentRuns += 1;

    try {
      await child.waitForInit();
      const typeAppend = resolveSubagentTypeAppend(normalizedType, this.config.subagent);
      const mergedSystem = [typeAppend, request.system_prompt]
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .join('\n\n');
      const runPromise = child.run(request.prompt, {
        systemPrompt: mergedSystem || undefined
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Subagent timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        runPromise.finally(() => clearTimeout(timer)).catch(() => {});
      });
      const result = await Promise.race([runPromise, timeoutPromise]);
      return {
        content: result.content,
        metadata: {
          sessionId: result.sessionId,
          subagentType: normalizedType,
          durationMs: Date.now() - startedAt,
          usage: result.usage,
          toolNames: resolved.tools.map(tool => tool.name),
          description: request.description
        }
      };
    } catch (error) {
      return {
        content: error instanceof Error ? error.message : String(error),
        isError: true,
        metadata: {
          subagentType: normalizedType,
          durationMs: Date.now() - startedAt,
          description: request.description,
          error: error instanceof Error ? error.message : String(error)
        }
      };
    } finally {
      this.activeSubagentRuns -= 1;
      await child.destroy();
    }
  }

  /**
   * 获取默认系统提示词
   */
  static getDefaultSystemPrompt(): string {
    return DEFAULT_SYSTEM_PROMPT;
  }

  /**
   * 执行工具调用
   */
  private async executeTools(
    toolCalls: ToolCall[],
    iteration: number
  ): Promise<
    Array<{
      toolCallId: string;
      content: string;
      isError: boolean;
      error?: Error;
    }>
  > {
    const results = await Promise.all(
      toolCalls.map(async (tc) => {
        this.safeLifecycleVoid(() => {
          this.config.callbacks?.lifecycle?.onToolCallPlanned?.(tc, {
            ...this.baseRunContext(),
            iteration
          });
        });

        const startedAt = Date.now();

        this.safeLifecycleVoid(() => {
          this.config.callbacks?.lifecycle?.onToolExecutionStart?.({
            ...this.baseRunContext(),
            iteration,
            toolCallId: tc.id,
            toolName: tc.name,
            arguments: tc.arguments,
            projectDir: this.config.cwd || process.cwd(),
            agentDepth: this.agentDepth
          });
        });

        this.log('info', {
          component: 'tooling',
          event: 'tool.call.start',
          message: 'Executing tool call',
          sessionId: this.sessionManager.sessionId ?? undefined,
          toolName: tc.name,
          toolCallId: tc.id
        });

        try {
          const result = await this.toolRegistry.execute(tc.name, tc.arguments, {
            toolCallId: tc.id,
            projectDir: this.config.cwd || process.cwd(),
            agentDepth: this.agentDepth
          });
          const durationMs = Date.now() - startedAt;
          const isError = Boolean(result.isError);
          const error = isError ? new Error(result.content) : undefined;

          this.safeLifecycleVoid(() => {
            this.config.callbacks?.lifecycle?.onToolExecutionEnd?.({
              ...this.baseRunContext(),
              iteration,
              toolCallId: tc.id,
              toolName: tc.name,
              arguments: tc.arguments,
              projectDir: this.config.cwd || process.cwd(),
              agentDepth: this.agentDepth,
              durationMs,
              isError,
              executionError: undefined
            });
          });
          this.safeLifecycleVoid(() => {
            this.config.callbacks?.lifecycle?.onToolResult?.({
              ...this.baseRunContext(),
              iteration,
              toolCallId: tc.id,
              toolName: tc.name,
              arguments: tc.arguments,
              projectDir: this.config.cwd || process.cwd(),
              agentDepth: this.agentDepth,
              durationMs,
              isError,
              result
            });
          });

          this.log(isError ? 'warn' : 'info', {
            component: 'tooling',
            event: isError ? 'tool.call.error' : 'tool.call.end',
            message: isError ? 'Tool call returned an error' : 'Tool call completed',
            sessionId: this.sessionManager.sessionId ?? undefined,
            toolName: tc.name,
            toolCallId: tc.id,
            durationMs,
            ...(error
              ? {
                  errorName: error.name,
                  errorMessage: error.message
                }
              : {}),
            metadata: {
              resultLength: result.content.length
            }
          });

          return {
            toolCallId: tc.id,
            content: isError ? `Error: ${result.content}` : result.content,
            isError,
            error
          };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          const durationMs = Date.now() - startedAt;
          const synthetic: ToolResult = { content: err.message, isError: true };

          this.emitAgentError(err, {
            phase: 'tool',
            toolName: tc.name,
            toolCallId: tc.id,
            iteration
          });
          this.safeLifecycleVoid(() => {
            this.config.callbacks?.lifecycle?.onToolExecutionError?.(err, {
              phase: 'tool',
              toolName: tc.name,
              toolCallId: tc.id,
              iteration
            });
          });

          this.safeLifecycleVoid(() => {
            this.config.callbacks?.lifecycle?.onToolExecutionEnd?.({
              ...this.baseRunContext(),
              iteration,
              toolCallId: tc.id,
              toolName: tc.name,
              arguments: tc.arguments,
              projectDir: this.config.cwd || process.cwd(),
              agentDepth: this.agentDepth,
              durationMs,
              isError: true,
              executionError: err
            });
          });
          this.safeLifecycleVoid(() => {
            this.config.callbacks?.lifecycle?.onToolResult?.({
              ...this.baseRunContext(),
              iteration,
              toolCallId: tc.id,
              toolName: tc.name,
              arguments: tc.arguments,
              projectDir: this.config.cwd || process.cwd(),
              agentDepth: this.agentDepth,
              durationMs,
              isError: true,
              result: synthetic
            });
          });

          this.log('error', {
            component: 'tooling',
            event: 'tool.call.error',
            message: 'Tool call threw an exception',
            sessionId: this.sessionManager.sessionId ?? undefined,
            toolName: tc.name,
            toolCallId: tc.id,
            durationMs,
            errorName: err.name,
            errorMessage: err.message
          });
          return {
            toolCallId: tc.id,
            content: `Error: ${err.message}`,
            isError: true,
            error: err
          };
        }
      })
    );

    return results;
  }
}

/**
 * 创建 Agent 实例
 */
export function createAgent(config: AgentConfig): Agent {
  return new Agent(config);
}
