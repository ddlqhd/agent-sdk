import type {
  Message,
  StreamChunk,
  ToolCall,
  TokenUsage,
  AgentConfig,
  AgentResult,
  StreamEvent,
  SystemPrompt,
  MCPServerConfig
} from '../core/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { getAllBuiltinTools } from '../tools/builtin/index.js';
import { SessionManager } from '../storage/session.js';
import { DEFAULT_SYSTEM_PROMPT } from './prompts.js';
import { MemoryManager } from '../memory/manager.js';

/**
 * 流式执行选项
 */
export interface StreamOptions {
  sessionId?: string;
  systemPrompt?: SystemPrompt;
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
  private _mcpClients: Map<string, unknown> = new Map();
  private _skills: Map<string, unknown> = new Map();

  constructor(config: AgentConfig) {
    this.config = {
      maxIterations: 10,
      streaming: true,
      ...config
    };

    // 初始化工具注册中心
    this.toolRegistry = new ToolRegistry();

    // 注册内置工具
    if (config.tools !== undefined) {
      // 用户提供了自定义工具列表
      this.toolRegistry.registerMany(config.tools);
    } else {
      // 使用所有内置工具
      this.toolRegistry.registerMany(getAllBuiltinTools());
    }

    // 初始化会话管理器
    this.sessionManager = new SessionManager(config.storage);
  }

  /**
   * 构建系统提示词
   * 处理默认提示词、替换模式、追加模式
   */
  private buildSystemPrompt(customPrompt?: SystemPrompt): string {
    // 如果没有自定义提示词，返回默认提示词
    if (!customPrompt) {
      return DEFAULT_SYSTEM_PROMPT;
    }

    // 如果是字符串，默认为追加模式
    if (typeof customPrompt === 'string') {
      return `${DEFAULT_SYSTEM_PROMPT}\n\n${customPrompt}`;
    }

    // 如果是配置对象
    const { content, mode = 'append' } = customPrompt;

    if (mode === 'replace') {
      // 替换模式：完全使用自定义提示词
      return content;
    } else {
      // 追加模式：默认提示词 + 自定义内容
      return `${DEFAULT_SYSTEM_PROMPT}\n\n${content}`;
    }
  }

  /**
   * 流式执行
   */
  async *stream(input: string, options?: StreamOptions): AsyncIterable<StreamEvent> {
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
        const memoryManager = new MemoryManager(undefined, this.config.memoryConfig);
        const memoryContent = memoryManager.loadMemory();
        
        if (memoryContent) {
          this.messages.push({
            role: 'system',
            content: memoryContent
          });
        }
      }
    }

    // 添加用户消息
    this.messages.push({
      role: 'user',
      content: input
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
        const modelParams = {
          messages: this.messages,
          tools: this.toolRegistry.getAll(),
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens
        };

        const stream = this.config.model.stream(modelParams);
        let hasToolCalls = false;
        const toolCalls: ToolCall[] = [];
        let assistantContent = '';

        for await (const chunk of stream) {
          const events = this.processChunk(chunk);
          for (const event of events) {
            yield event;

            if (event.type === 'text_delta') {
              assistantContent += event.content;
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
              totalUsage = this.mergeUsage(totalUsage, event.data.usage as TokenUsage);
            }
          }
        }

        // 保存助手消息
        const assistantMessage: Message = {
          role: 'assistant',
          content: assistantContent
        };

        if (toolCalls.length > 0) {
          assistantMessage.toolCalls = toolCalls;
        }

        this.messages.push(assistantMessage);

        // 如果没有工具调用，结束循环
        if (!hasToolCalls) {
          break;
        }

        // 执行工具调用
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

      // 保存会话
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
  async loadSkill(_path: string): Promise<void> {
    // 将在 Skill 系统中实现
    // 这里预留接口
    void this._skills; // 保留引用以备后用
  }

  /**
   * 连接 MCP 服务器
   */
  async connectMCP(_config: MCPServerConfig): Promise<void> {
    // 将在 MCP 集成中实现
    // 这里预留接口
    void this._mcpClients; // 保留引用以备后用
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
        if (chunk.content) {
          events.push({ type: 'thinking', content: chunk.content });
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

  /**
   * 合并 Token 使用统计
   */
  private mergeUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
    return {
      promptTokens: a.promptTokens + b.promptTokens,
      completionTokens: a.completionTokens + b.completionTokens,
      totalTokens: a.totalTokens + b.totalTokens
    };
  }
}

/**
 * 创建 Agent 实例
 */
export function createAgent(config: AgentConfig): Agent {
  return new Agent(config);
}
