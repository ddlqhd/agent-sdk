import type {
  StreamChunk,
  ToolCall,
  TokenUsage,
  SessionTokenUsage,
  AgentConfig,
  AgentResult,
  StreamEvent,
  SystemPrompt,
  MCPServerConfig,
  ContextManagerConfig,
  Message
} from '../core/types.js';
import { homedir } from 'os';
import { join } from 'path';
import { ToolRegistry } from '../tools/registry.js';
import { getAllBuiltinTools } from '../tools/builtin/index.js';
import { SessionManager } from '../storage/session.js';
import { DEFAULT_SYSTEM_PROMPT } from './prompts.js';
import { MemoryManager } from '../memory/manager.js';
import { getEnvironmentInfo, formatEnvironmentSection } from './environment.js';
import { MCPAdapter } from '../mcp/adapter.js';
import type { MCPClientConfig } from '../mcp/client.js';
import { SkillRegistry, createSkillRegistry } from '../skills/registry.js';
import { createSkillTemplateProcessor } from '../skills/template.js';
import type { SkillTemplateContext } from '../skills/template.js';
import { ContextManager } from './context-manager.js';

function toMCPClientConfig(config: MCPServerConfig): MCPClientConfig {
  if (config.transport === 'http') {
    return {
      name: config.name,
      url: config.url!,
      headers: config.headers
    };
  }
  return {
    name: config.name,
    command: config.command!,
    args: config.args,
    env: config.env
  };
}

/**
 * 流式执行选项
 */
export interface StreamOptions {
  sessionId?: string;
  systemPrompt?: SystemPrompt;
  signal?: AbortSignal;
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

  // Token 使用量统计
  // contextTokens: 当前上下文大小 (用于压缩判断)
  // inputTokens/outputTokens: 累计消耗
  // totalTokens: 累计总消耗 (inputTokens + outputTokens)
  private sessionUsage: SessionTokenUsage = {
    contextTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0
  };

  constructor(config: AgentConfig) {
    this.config = {
      maxIterations: 200,
      streaming: true,
      ...config
    };

    // 初始化 Skill 注册中心
    this.skillRegistry = createSkillRegistry({
      cwd: config.cwd,
      userBasePath: config.userBasePath
    });

    // 初始化工具注册中心
    this.toolRegistry = new ToolRegistry();

    // 注册内置工具（包含 Skill 工具）
    if (config.tools !== undefined) {
      // 用户提供了自定义工具列表
      this.toolRegistry.registerMany(config.tools);
    } else {
      // 使用所有内置工具（包含 skill 工具）
      this.toolRegistry.registerMany(getAllBuiltinTools(this.skillRegistry));
    }

    // 初始化会话管理器（存储在用户目录下）
    const storageBasePath = join(config.userBasePath || homedir(), '.claude', 'sessions');
    this.sessionManager = new SessionManager({
      type: config.storage?.type || 'jsonl',
      basePath: storageBasePath
    });

    // 初始化 ContextManager
    if (config.contextManagement !== false) {
      const cmConfig: ContextManagerConfig = config.contextManagement === true
        ? {}
        : config.contextManagement ?? {};

      this.contextManager = new ContextManager(config.model, cmConfig);
    }

    // 启动异步初始化，保存 Promise 供外部等待
    this.initPromise = this.initializeAsync();
  }

  /**
   * 异步初始化（skills 和 MCP）
   */
  private async initializeAsync(): Promise<void> {
    try {
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
      console.error('Failed to initialize:', err);
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
        console.error(`Failed to connect MCP server "${serverConfig.name}":`, err);
      }
    }
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
      try {
        this.messages = await this.sessionManager.resumeSession(options.sessionId);
      } catch {
        this.sessionManager.createSession(options.sessionId);
      }
    } else if (!this.sessionManager.sessionId) {
      this.sessionManager.createSession();
    }

    // 添加系统提示
    if (this.messages.length === 0) {
      // 合并配置中的 systemPrompt 和运行时的 systemPrompt
      const systemPrompt = this.buildSystemPrompt(
        options?.systemPrompt || this.config.systemPrompt
      );
      this.messages.push({
        role: 'system',
        content: systemPrompt
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
          this.messages.push({
            role: 'system',
            content: memoryContent
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

    // 添加用户消息
    this.messages.push({
      role: 'user',
      content: processedInput
    });

    yield { type: 'start', timestamp: Date.now() };

    try {
      const maxIterations = this.config.maxIterations || 10;
      let totalUsage: TokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      };

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (signal?.aborted) {
          yield { type: 'metadata', data: { event: 'aborted' } };
          yield { type: 'end', usage: totalUsage, timestamp: Date.now() };
          return;
        }

        // 上下文压缩检查
        const contextEvents = await this.checkContextCompression();
        for (const event of contextEvents) {
          yield event;
        }

        const modelParams = {
          messages: this.messages,
          tools: this.toolRegistry.getAll(),
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          signal
        };

        const stream = this.config.model.stream(modelParams);
        let hasToolCalls = false;
        const toolCalls: ToolCall[] = [];
        let assistantContent = '';
        let thinkingContent = '';
        let thinkingSignature: string | undefined;

        for await (const chunk of stream) {
          if (signal?.aborted) {
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
            }

            this.messages.push({
              role: 'user',
              content: '[User interrupted the response]'
            });

            await this.sessionManager.saveMessages(this.messages);

            yield {
              type: 'metadata',
              data: {
                event: 'aborted',
                partialContent: assistantContent
              }
            };
            yield { type: 'end', usage: totalUsage, timestamp: Date.now() };
            return;
          }

          const events = this.processChunk(chunk);
          for (const event of events) {
            yield event;

            if (event.type === 'text_delta') {
              assistantContent += event.content;
            }

            if (event.type === 'thinking') {
              thinkingContent += event.content;
              if (event.signature !== undefined && !thinkingSignature) {
                thinkingSignature = event.signature;
              }
            }

            if (event.type === 'tool_call') {
              hasToolCalls = true;
              toolCalls.push({
                id: event.id,
                name: event.name,
                arguments: event.arguments
              });
            }

            if (event.type === 'metadata' && event.data?.usage) {
              const usage = event.data.usage as TokenUsage;

              if (usage.promptTokens > 0) {
                totalUsage.promptTokens = usage.promptTokens;
                this.sessionUsage.contextTokens = usage.promptTokens;
                this.sessionUsage.inputTokens += usage.promptTokens;
              }
              totalUsage.completionTokens += usage.completionTokens;
              totalUsage.totalTokens = totalUsage.promptTokens + totalUsage.completionTokens;
              this.sessionUsage.outputTokens += usage.completionTokens;
            }
          }
        }

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

        if (!hasToolCalls) {
          break;
        }

        const toolResults = await this.executeTools(toolCalls);

        for (const result of toolResults) {
          yield {
            type: 'tool_result',
            toolCallId: result.toolCallId,
            result: result.content
          };

          this.messages.push({
            role: 'tool',
            toolCallId: result.toolCallId,
            content: result.content
          });
        }
      }

      await this.sessionManager.saveMessages(this.messages);

      yield {
        type: 'metadata',
        data: {
          sessionId: this.sessionManager.sessionId,
          usage: totalUsage,
          iterations: Math.min(maxIterations, this.messages.length)
        }
      };

      yield { type: 'end', usage: totalUsage, timestamp: Date.now() };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        yield { type: 'metadata', data: { event: 'aborted' } };
        yield { type: 'end', timestamp: Date.now() };
        return;
      }
      yield { type: 'error', error: error as Error };
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

      if (event.type === 'metadata' && event.data?.usage) {
        usage = event.data.usage as TokenUsage;
      }

      if (event.type === 'end') {
        usage = event.usage;
      }
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
    this.toolRegistry.registerMany(tools);
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

    await this.mcpAdapter.addServer(toMCPClientConfig(config));

    const mcpTools = this.mcpAdapter.getToolDefinitions();
    for (const tool of mcpTools) {
      if (tool.name.startsWith(`mcp_${config.name}__`)) {
        this.toolRegistry.register(tool);
      }
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
      if (tool.name.startsWith(`mcp_${name}__`)) {
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
      if (tool.name.startsWith('mcp_') && tool.name.includes('__')) {
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
    this.messages = [];
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

    return [{
      type: 'metadata',
      data: {
        event: 'context_compressed',
        stats: result.stats
      }
    }];
  }

  /**
   * 获取默认系统提示词
   */
  static getDefaultSystemPrompt(): string {
    return DEFAULT_SYSTEM_PROMPT;
  }

  /**
   * 处理流式块
   */
  private processChunk(chunk: StreamChunk): StreamEvent[] {
    const events: StreamEvent[] = [];

    switch (chunk.type) {
      case 'text':
        if (chunk.content) {
          events.push({ type: 'text_delta', content: chunk.content });
        }
        break;

      case 'tool_call':
        if (chunk.toolCall) {
          events.push({
            type: 'tool_call',
            id: chunk.toolCall.id,
            name: chunk.toolCall.name,
            arguments: chunk.toolCall.arguments
          });
        }
        break;

      case 'tool_call_start':
        if (chunk.toolCall) {
          events.push({
            type: 'tool_call_start',
            id: chunk.toolCall.id,
            name: chunk.toolCall.name
          });
        }
        break;

      case 'tool_call_delta':
        if (chunk.toolCallId && chunk.content) {
          events.push({
            type: 'tool_call_delta',
            id: chunk.toolCallId,
            arguments: chunk.content
          });
        }
        break;

      case 'thinking':
        if (chunk.content !== undefined) {
          events.push({
            type: 'thinking',
            content: chunk.content,
            signature: chunk.signature
          });
        }
        break;

      case 'error':
        if (chunk.error) {
          events.push({ type: 'error', error: chunk.error });
        }
        break;

      case 'metadata':
        if (chunk.metadata) {
          events.push({ type: 'metadata', data: chunk.metadata });
        }
        break;
    }

    return events;
  }

  /**
   * 执行工具调用
   */
  private async executeTools(toolCalls: ToolCall[]): Promise<Array<{
    toolCallId: string;
    content: string;
  }>> {
    const results = await Promise.all(
      toolCalls.map(async (tc) => {
        const result = await this.toolRegistry.execute(tc.name, tc.arguments);
        return {
          toolCallId: tc.id,
          content: result.isError
            ? `Error: ${result.content}`
            : result.content
        };
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
