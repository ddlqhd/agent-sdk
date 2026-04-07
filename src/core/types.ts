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
 * 思考内容部分 (用于支持 extended thinking)
 */
export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  signature?: string;
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
export type ContentPart = TextContent | ThinkingContent | ImageContent;

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
  /**
   * When true, adapters may attach `providerRaw` on each {@link StreamChunk} (e.g. Anthropic SSE JSON object).
   */
  includeRawStreamEvents?: boolean;
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
  /** When `type === 'metadata'`, distinguishes prompt vs completion usage timing (e.g. Anthropic). */
  usagePhase?: 'input' | 'output';
  signature?: string;
  /** Raw provider streaming payload when {@link ModelParams.includeRawStreamEvents} is enabled */
  providerRaw?: unknown;
}

/**
 * 完成结果
 */
export interface CompletionResult {
  content: string;
  /** Ollama extended thinking trace (when using thinking-capable models). */
  thinking?: string;
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
 * 会话 Token 使用统计
 *
 * 关键区分：
 * - contextTokens: 当前上下文大小 (最近一次 API 返回的 input_tokens，用于压缩判断)
 * - inputTokens: 累计输入消耗
 * - outputTokens: 累计输出消耗
 * - totalTokens: 累计总消耗 (inputTokens + outputTokens)
 */
export interface SessionTokenUsage {
  /** 当前上下文 tokens (最近一次 API 返回的 input_tokens，用于压缩判断) */
  contextTokens: number;
  /** 累计输入 tokens */
  inputTokens: number;
  /** 累计输出 tokens */
  outputTokens: number;
  /** 累计缓存读取 tokens */
  cacheReadTokens: number;
  /** 累计缓存写入 tokens */
  cacheWriteTokens: number;
  /** 累计总 tokens (inputTokens + outputTokens) */
  totalTokens: number;
}

/**
 * 模型能力描述
 */
export interface ModelCapabilities {
  /** 上下文窗口长度 (tokens) */
  contextLength: number;
  /** 最大输出 token 数 */
  maxOutputTokens?: number;
}

/**
 * 模型适配器接口
 */
export interface ModelAdapter {
  /** 模型名称 */
  name: string;

  /** 模型能力 (可选) */
  capabilities?: ModelCapabilities;

  /** 流式生成 */
  stream(params: ModelParams): AsyncIterable<StreamChunk>;

  /** 完整生成 */
  complete(params: ModelParams): Promise<CompletionResult>;
}

// ==================== Tool 类型 ====================

/**
 * 工具结果元数据
 */
export interface ToolResultMetadata {
  /** 是否被截断 */
  truncated?: boolean;
  /** 原始内容长度 */
  originalLength?: number;
  /** 原始行数 */
  originalLineCount?: number;
  /** 显示的行数 */
  displayedLineCount?: number;
  /** 完整内容保存路径 */
  storagePath?: string;
  /** 行数统计 */
  lineCount?: number;
  /** 其他自定义字段 */
  [key: string]: unknown;
}

/**
 * 工具结果
 */
export interface ToolResult {
  content: string;
  isError?: boolean;
  metadata?: ToolResultMetadata;
}

/**
 * Tool 执行上下文
 */
export interface ToolExecutionContext {
  /** 工具调用 ID */
  toolCallId?: string;
  /** Agent 配置的工作目录 */
  projectDir?: string;
  /** 当前 agent 深度（根 agent 为 0） */
  agentDepth?: number;
}

/**
 * 工具处理函数
 */
export type ToolHandler = (args: any, context?: ToolExecutionContext) => Promise<ToolResult>;

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
  parameters: Record<string, unknown>;
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
  | 'start'
  | 'end'
  | 'model_usage'
  | 'session_summary'
  | 'context_compressed';

/**
 * Optional fields on any stream event (observability, Claude-style correlation).
 */
export interface StreamEventAnnotations {
  streamEventId?: string;
  /** Agent model-call iteration (0-based) when produced by {@link Agent.stream} */
  iteration?: number;
  /**
   * Current session id when {@link Agent.stream} annotates events (including `session_summary`).
   * Not duplicated on the `session_summary` variant payload; use this field for correlation.
   */
  sessionId?: string;
}

/**
 * 流式事件
 */
export type StreamEvent = (
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
  | { type: 'thinking'; content: string; signature?: string }
  | {
      type: 'model_usage';
      usage: TokenUsage;
      /** Present when the provider distinguishes prompt vs completion usage timing (e.g. Anthropic). */
      phase?: 'input' | 'output';
    }
  | {
      type: 'session_summary';
      /** Authoritative cumulative usage for the completed run (prefer over end.usage when both exist). */
      usage: TokenUsage;
      iterations: number;
    }
  | {
      type: 'end';
      timestamp: number;
      /**
       * Optional usage (e.g. aborted mid-stream). When a session_summary event was emitted, use its usage for totals.
       */
      usage?: TokenUsage;
      /** Omitted or `complete` = normal completion */
      reason?: 'complete' | 'aborted' | 'error';
      error?: Error;
      partialContent?: string;
    }
  | {
      type: 'context_compressed';
      stats: {
        originalMessageCount: number;
        compressedMessageCount: number;
        durationMs: number;
      };
    }
) &
  StreamEventAnnotations;

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

  /** 依赖的 Skills */
  dependencies?: string[];

  /** 标签 */
  tags?: string[];

  /** 参数提示，显示在自动补全中，如 "[filename]" */
  argumentHint?: string;

  /** 禁止模型自动调用此 skill，只能通过 /skill-name 手动调用 */
  disableModelInvocation?: boolean;

  /** 是否在 / 菜单中显示，默认 true */
  userInvocable?: boolean;
}

/**
 * Skill 定义
 * Skill 只是一个指导书，不提供工具
 */
export interface SkillDefinition {
  /** 元数据 */
  metadata: SkillMetadata;

  /** 文件路径 */
  path: string;

  /** 指令内容 */
  instructions: string;
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

  /** 是否包含环境信息，默认 true */
  includeEnvironment?: boolean;
}

/**
 * 系统提示类型 - 支持字符串或配置对象
 */
export type SystemPrompt = string | SystemPromptConfig;

/**
 * 上下文管理配置
 */
export interface ContextManagerConfig {
  /** 上下文窗口大小 (从模型 capabilities 自动获取) */
  contextLength?: number;
  /** 最大输出 token 数 (从模型 capabilities 自动获取) */
  maxOutputTokens?: number;
  /** 压缩预留空间 (tokens), 默认 min(20000, maxOutputTokens) */
  reserved?: number;
  /** 自定义压缩器 */
  compressor?: import('./compressor.js').Compressor;
  /** 是否启用 prune (清理旧工具输出), 默认 true */
  prune?: boolean;
  /** prune 触发阈值 (tokens), 默认 20000 */
  pruneMinimum?: number;
  /** prune 保护范围 (最近 N tokens 的工具输出不清理), 默认 40000 */
  pruneProtect?: number;
}

/**
 * 非自动批准的工具在调用前回调；返回 true 表示允许执行（与 Claude Agent SDK 的 canUseTool 概念对齐）。
 */
export type CanUseToolCallback = (
  toolName: string,
  input: Record<string, unknown>
) => boolean | Promise<boolean>;

/**
 * {@link ToolRegistry} 可选执行策略（与 {@link AgentConfig} 中 allowedTools / disallowedTools / canUseTool 对应）。
 */
export interface ToolExecutionPolicy {
  disallowedTools?: string[];
  /**
   * 与 {@link AgentConfig.allowedTools} 相同。若设为**空数组** `[]`，则没有任何工具自动批准，每次执行均需 {@link canUseTool} 放行（未配置则拒绝）。
   */
  allowedTools?: string[];
  canUseTool?: CanUseToolCallback;
}

/**
 * 与 `createModel` 参数对齐，供 `AgentConfig.modelConfig` 使用（避免 `types` 依赖 `models`）。
 */
export interface AgentModelConfig {
  provider: 'openai' | 'anthropic' | 'ollama';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Ollama：对应 `/api/chat` 的 `think` */
  think?: boolean | 'low' | 'medium' | 'high';
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  /**
   * 模型适配器；与 {@link modelConfig} 二选一。
   * 若需让 {@link env} 参与 API Key 等解析，请使用 `modelConfig`，由 Agent 内部调用 {@link mergeProcessEnv} 后构造适配器。
   */
  model?: ModelAdapter;

  /**
   * 由 Agent 在内部通过 `createModel(modelConfig, env)` 构造适配器；与 `model` 二选一。
   */
  modelConfig?: AgentModelConfig;

  /** 系统提示 (字符串或配置对象) */
  systemPrompt?: SystemPrompt;

  /**
   * 追加到默认内置工具（及 MCP）之后的自定义工具；同名会覆盖内置定义。
   * 与 {@link exclusiveTools} 互斥：若设置了 `exclusiveTools`，则忽略本字段。
   */
  tools?: ToolDefinition[];

  /**
   * 自动批准的工具名列表（与注册名一致）。命中的调用直接执行，无需 {@link canUseTool}。
   * 未列出的工具仍可对模型可见；其调用需经 `canUseTool`（若配置），否则拒绝。
   * **未设置**时保持兼容：所有非 {@link disallowedTools} 工具均视为自动批准。
   * **空数组** `[]` 表示无任何自动批准：所有工具调用均需 `canUseTool` 放行，未配置 `canUseTool` 则全部拒绝。
   */
  allowedTools?: string[];

  /**
   * 禁止的工具名：不注册、不纳入模型工具列表、不可执行（内置 / MCP / 自定义均按注册名生效）。
   */
  disallowedTools?: string[];

  /**
   * 当工具不在 {@link allowedTools} 中（且 `allowedTools` 已配置）时调用；返回 true 则执行。
   */
  canUseTool?: CanUseToolCallback;

  /**
   * 仅注册此处列出的工具（用于子 Agent 等排他场景），不合并默认内置，不追加 {@link tools}。
   * 仍应用 {@link disallowedTools} 过滤。
   */
  exclusiveTools?: ToolDefinition[];

  /**
   * AskUserQuestion 交互解析（CLI / Web 等实现）。未设置时该工具仅返回题面、不阻塞。
   */
  askUserQuestion?: import('../tools/builtin/interaction.js').AskUserQuestionResolver;

  /** Skill 路径列表 */
  skills?: string[];

  /** MCP 服务器配置 */
  mcpServers?: MCPServerConfig[];

  /**
   * 对当前进程环境的补充与覆盖（合并到 stdio MCP 子进程；键与 `process.env` 冲突时以本字段为准）。
   * 与 {@link includeEnvironment}（往 system prompt 注入工作区描述）无关。
   * 使用 `modelConfig` 时，`env` 会一并用于构造模型适配器；若传入现成 `model`，请自行用 `mergeProcessEnv` 解析密钥等。
   * 完整继承会将 `process.env` 中的敏感变量一并带入 MCP 子进程，由调用方控制。
   */
  env?: Record<string, string>;

  /** 用户级基础路径，默认 ~ (homedir)，用于定位 .claude/ 目录 */
  userBasePath?: string;

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

  /** Skill 加载配置 */
  skillConfig?: SkillConfig;

  /** 上下文管理配置 */
  contextManagement?: boolean | ContextManagerConfig;

  /** 工作目录，默认 process.cwd() */
  cwd?: string;

  /** 是否注入环境信息到 system prompt，默认 true */
  includeEnvironment?: boolean;

  /** 工具 Hook 管理器（与配置文件合并规则见文档） */
  hookManager?: import('../tools/hooks/manager.js').HookManager;

  /**
   * 解析项目级 `.claude/settings.json` 的目录；设置后将在 Agent 初始化时加载 Hook 配置
   */
  hookConfigDir?: string;

  /** Subagent 工具行为配置 */
  subagent?: {
    /** 是否启用 Agent 工具，默认 true */
    enabled?: boolean;
    /** 子代理最大深度，默认 1（禁止嵌套） */
    maxDepth?: number;
    /** 并发子代理上限，默认 5 */
    maxParallel?: number;
    /** 子代理默认超时（毫秒），默认 120000 */
    timeoutMs?: number;
    /** 是否允许子代理使用危险工具，默认 false */
    allowDangerousTools?: boolean;
    /** 子代理默认允许工具列表（为空时自动使用安全工具） */
    defaultAllowedTools?: string[];
  };
}

/**
 * 记忆配置选项
 */
export interface MemoryConfig {
  /** 工作空间记忆文件路径 */
  workspacePath?: string;
}

/**
 * Skill 加载配置选项
 */
export interface SkillConfig {
  /** 是否启用默认路径加载，默认 true */
  autoLoad?: boolean;
  /** 工作空间 skills 路径，默认 ./.claude/skills/ */
  workspacePath?: string;
  /** 额外的 skills 路径列表 */
  additionalPaths?: string[];
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

  /** 恢复最近一次会话（CLI chat/run） */
  resume?: boolean;

  /** 详细输出 */
  verbose?: boolean;

  /** MCP 配置文件路径 */
  mcpConfig?: string;

  /** 用户级基础路径，默认 ~ (homedir) */
  userBasePath?: string;

  /** 工作目录 */
  cwd?: string;

  /**
   * Ollama `/api/chat` `think` option (boolean or GPT-OSS level).
   * Used only when `-m`/`--model` is `ollama`.
   */
  ollamaThink?: boolean | 'low' | 'medium' | 'high';
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
