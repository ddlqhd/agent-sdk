import { z } from 'zod';

// ==================== 消息类型 ====================

/**
 * 文本内容部分
 */
export interface TextContent {
  type: 'text';
  text: string;
}

/**
 * 图片内容部分
 */
export interface ImageContent {
  type: 'image';
  imageUrl: string;
  mimeType?: string;
}

/**
 * 内容部分联合类型
 */
export type ContentPart = TextContent | ImageContent;

/**
 * 工具调用
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

/**
 * 消息角色
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * 消息
 */
export interface Message {
  role: MessageRole;
  content: string | ContentPart[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  timestamp?: number;
}

/**
 * 系统消息
 */
export interface SystemMessage extends Message {
  role: 'system';
  content: string;
}

/**
 * 用户消息
 */
export interface UserMessage extends Message {
  role: 'user';
  content: string | ContentPart[];
}

/**
 * 助手消息
 */
export interface AssistantMessage extends Message {
  role: 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

/**
 * 工具结果消息
 */
export interface ToolMessage extends Message {
  role: 'tool';
  content: string;
  toolCallId: string;
}

// ==================== 模型类型 ====================

/**
 * 模型参数
 */
export interface ModelParams {
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  signal?: AbortSignal;
}

/**
 * 流式块类型
 */
export type StreamChunkType =
  | 'text'
  | 'tool_call'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_end'
  | 'thinking'
  | 'error'
  | 'done'
  | 'metadata';

/**
 * 流式块
 */
export interface StreamChunk {
  type: StreamChunkType;
  content?: string;
  toolCall?: ToolCall;
  toolCallId?: string;
  error?: Error;
  metadata?: Record<string, unknown>;
}

/**
 * 完成结果
 */
export interface CompletionResult {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  metadata?: Record<string, unknown>;
}

/**
 * Token 使用统计
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * 模型适配器接口
 */
export interface ModelAdapter {
  /** 模型名称 */
  name: string;

  /** 流式生成 */
  stream(params: ModelParams): AsyncIterable<StreamChunk>;

  /** 完整生成 */
  complete(params: ModelParams): Promise<CompletionResult>;
}

// ==================== Tool 类型 ====================

/**
 * 工具结果
 */
export interface ToolResult {
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * 工具处理函数
 */
export type ToolHandler = (args: any) => Promise<ToolResult>;

/**
 * 工具定义
 */
export interface ToolDefinition {
  /** 工具名称 */
  name: string;

  /** 工具描述 */
  description: string;

  /** 参数 Schema (Zod) */
  parameters: z.ZodSchema;

  /** 处理函数 */
  handler: ToolHandler;

  /** 是否危险操作 */
  isDangerous?: boolean;

  /** 工具分类 (e.g., "filesystem", "shell", "web", "planning") */
  category?: string;
}

/**
 * 工具 Schema (用于模型调用)
 */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ==================== Session 类型 ====================

/**
 * 会话信息
 */
export interface SessionInfo {
  id: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  metadata?: Record<string, unknown>;
}

/**
 * 存储配置
 */
export interface StorageConfig {
  type: 'jsonl' | 'memory';
  basePath?: string;
}

/**
 * 存储适配器接口
 */
export interface StorageAdapter {
  /** 保存消息 */
  save(sessionId: string, messages: Message[]): Promise<void>;

  /** 加载消息 */
  load(sessionId: string): Promise<Message[]>;

  /** 列出会话 */
  list(): Promise<SessionInfo[]>;

  /** 删除会话 */
  delete(sessionId: string): Promise<void>;

  /** 会话是否存在 */
  exists(sessionId: string): Promise<boolean>;
}

// ==================== 流式事件类型 ====================

/**
 * 流式事件类型
 */
export type StreamEventType =
  | 'text_delta'
  | 'text_start'
  | 'text_end'
  | 'tool_call'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_end'
  | 'tool_result'
  | 'tool_error'
  | 'thinking'
  | 'error'
  | 'start'
  | 'end'
  | 'metadata';

/**
 * 流式事件
 */
export type StreamEvent =
  | { type: 'start'; timestamp: number }
  | { type: 'text_start'; content?: string }
  | { type: 'text_delta'; content: string }
  | { type: 'text_end'; content?: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; arguments: string }
  | { type: 'tool_call'; id: string; name: string; arguments: unknown }
  | { type: 'tool_call_end'; id: string }
  | { type: 'tool_result'; toolCallId: string; result: string }
  | { type: 'tool_error'; toolCallId: string; error: Error }
  | { type: 'thinking'; content: string }
  | { type: 'error'; error: Error }
  | { type: 'metadata'; data: Record<string, unknown> }
  | { type: 'end'; usage?: TokenUsage; timestamp: number };

// ==================== MCP 类型 ====================

/**
 * MCP 服务器配置
 */
export interface MCPServerConfig {
  /** 服务器名称 */
  name: string;

  /** 传输类型 */
  transport: 'stdio' | 'http';

  /** stdio 配置 */
  command?: string;
  args?: string[];
  env?: Record<string, string>;

  /** HTTP 配置 */
  url?: string;
  headers?: Record<string, string>;
}

/**
 * MCP 资源
 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * MCP 资源内容
 */
export interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

/**
 * MCP Prompt
 */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
}

/**
 * MCP Prompt 参数
 */
export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

// ==================== Skill 类型 ====================

/**
 * Skill 元数据
 */
export interface SkillMetadata {
  /** Skill 名称 */
  name: string;

  /** 描述 */
  description: string;

  /** 版本 */
  version?: string;

  /** 作者 */
  author?: string;

  /** 提供的工具 */
  tools?: string[];

  /** 依赖的 Skills */
  dependencies?: string[];

  /** 标签 */
  tags?: string[];
}

/**
 * Skill 定义
 */
export interface SkillDefinition {
  /** 元数据 */
  metadata: SkillMetadata;

  /** 文件路径 */
  path: string;

  /** 指令内容 */
  instructions: string;

  /** 提供的工具 */
  tools?: ToolDefinition[];

  /** 引用文件 */
  references?: string[];
}

/**
 * Skill 解析结果
 */
export interface ParsedSkill {
  metadata: SkillMetadata;
  content: string;
}

// ==================== Agent 类型 ====================

/**
 * 系统提示配置
 */
export interface SystemPromptConfig {
  /** 提示内容 */
  content: string;

  /** 模式: 'replace' 替换默认提示词, 'append' 追加到默认提示词 */
  mode?: 'replace' | 'append';
}

/**
 * 系统提示类型 - 支持字符串或配置对象
 */
export type SystemPrompt = string | SystemPromptConfig;

/**
 * Agent 配置
 */
export interface AgentConfig {
  /** 模型适配器 */
  model: ModelAdapter;

  /** 系统提示 (字符串或配置对象) */
  systemPrompt?: SystemPrompt;

  /** 工具列表 */
  tools?: ToolDefinition[];

  /** Skill 路径列表 */
  skills?: string[];

  /** MCP 服务器配置 */
  mcpServers?: MCPServerConfig[];

  /** 存储配置 */
  storage?: StorageConfig;

  /** 最大迭代次数 */
  maxIterations?: number;

  /** 温度 */
  temperature?: number;

  /** 最大 Token 数 */
  maxTokens?: number;

  /** 是否启用流式 */
  streaming?: boolean;

  /** 会话 ID (用于恢复会话) */
  sessionId?: string;

  /** 回调函数 */
  callbacks?: AgentCallbacks;

  /** 是否启用长期记忆 */
  memory?: boolean;

  /** 记忆配置 */
  memoryConfig?: MemoryConfig;
}

/**
 * 记忆配置选项
 */
export interface MemoryConfig {
  /** 用户主目录记忆文件路径 */
  userHomePath?: string;
  /** 工作空间记忆文件路径 */
  workspacePath?: string;
}

/**
 * Agent 回调
 */
export interface AgentCallbacks {
  /** 流式事件回调 */
  onEvent?: (event: StreamEvent) => void;

  /** 工具执行前回调 */
  beforeToolCall?: (toolCall: ToolCall) => Promise<boolean | void>;

  /** 工具执行后回调 */
  afterToolCall?: (toolCall: ToolCall, result: ToolResult) => void;

  /** 错误回调 */
  onError?: (error: Error) => void;
}

/**
 * Agent 执行结果
 */
export interface AgentResult {
  /** 最终内容 */
  content: string;

  /** 工具调用历史 */
  toolCalls?: Array<{
    name: string;
    arguments: unknown;
    result: string;
  }>;

  /** Token 使用 */
  usage?: TokenUsage;

  /** 会话 ID */
  sessionId: string;

  /** 迭代次数 */
  iterations: number;
}

// ==================== CLI 类型 ====================

/**
 * CLI 配置
 */
export interface CLIConfig {
  /** 模型 */
  model?: string;

  /** API Key */
  apiKey?: string;

  /** 基础 URL */
  baseUrl?: string;

  /** 模型名称 */
  modelName?: string;

  /** 温度 */
  temperature?: number;

  /** 最大 Token */
  maxTokens?: number;

  /** 输出格式 */
  output?: 'text' | 'json' | 'markdown';

  /** 是否流式 */
  stream?: boolean;

  /** 会话 ID */
  session?: string;

  /** 详细输出 */
  verbose?: boolean;
}

/**
 * CLI 命令选项
 */
export interface ChatOptions extends CLIConfig {
  systemPrompt?: string;
  tools?: string[];
}

export interface RunOptions extends CLIConfig {
  file?: string;
  files?: string[];
}

export interface ToolListOptions {
  format?: 'table' | 'json';
}

export interface SessionListOptions {
  format?: 'table' | 'json';
  limit?: number;
}

export interface MCPOptions {
  name?: string;
}

export interface SkillOptions {
  path?: string;
}
