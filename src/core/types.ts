import { z } from 'zod';
import type {
  AgentErrorContext,
  AgentLifecycleCallbacks,
  AgentRunEndReason
} from './callbacks.js';
import type { SubagentProfile } from '../subagents/types.js';

export type {
  AgentErrorContext,
  AgentLifecycleCallbacks,
  AgentRunContext,
  AgentRunStartContext,
  AgentRunEndContext,
  AgentRunEndReason,
  HookDecisionContext,
  HookObservationContext,
  MessageObservationContext,
  ModelRequestStartContext,
  SystemMessageSource,
  ToolExecutionBaseContext,
  ToolExecutionEndContext,
  ToolHookObserver,
  ToolResultObservationContext,
  UserMessageSource
} from './callbacks.js';

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
 * SDK 日志级别
 */
export type SDKLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * SDK 结构化日志事件
 */
export interface LogEvent {
  /** 固定来源标识，便于宿主应用统一过滤 */
  source: 'agent-sdk';
  /**
   * 事件发生时间。由 {@link emitSDKLog} 写入可读串 `YYYY-MM-DD HH:mm:ss.sss ±HH:mm`（本地 / IANA，`AGENT_SDK_LOG_TZ`）或 UTC 后缀 `Z`；
   * 调用方亦可传入毫秒数或可 `Date.parse` 的字符串，输出前会据此统一格式化。
   */
  timestamp?: string | number;
  component:
    | 'agent'
    | 'model'
    | 'streaming'
    | 'tooling'
    | 'memory'
    | 'skill'
    | 'session'
    | 'mcp'
    | 'hooks';
  event: string;
  message?: string;

  provider?: string;
  model?: string;
  operation?: 'stream' | 'complete' | 'compress' | 'tool_call' | 'persist' | 'skill_load';

  /** 单次 `stream()` / `run()` 对齐用 ID */
  runId?: string;
  /** 宿主配置的逻辑名 {@link AgentConfig.agentName}，默认 `'Agent'` */
  agentName?: string;
  finishReason?: AgentRunEndReason;
  /** Token 用量摘要（不写全量消息） */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };

  sessionId?: string;
  cwd?: string;
  iteration?: number;
  toolName?: string;
  toolCallId?: string;

  requestId?: string;
  clientRequestId?: string;
  statusCode?: number;
  durationMs?: number;
  /** HTTP 重试时当前尝试序号（从 1 计） */
  httpAttempt?: number;
  httpMaxAttempts?: number;

  errorName?: string;
  errorMessage?: string;

  metadata?: Record<string, unknown>;
}

/**
 * SDK Logger 接口。宿主应用可将其桥接到 pino / winston / OTel 等实现。
 */
export interface SDKLogger {
  debug?(event: LogEvent): void;
  info?(event: LogEvent): void;
  warn?(event: LogEvent): void;
  error?(event: LogEvent): void;
}

/**
 * 日志脱敏与输出控制
 */
export interface LogRedactionConfig {
  /** 是否记录请求/响应 body，默认 false */
  includeBodies?: boolean;
  /** 是否记录工具调用参数，默认 false */
  includeToolArguments?: boolean;
  /** 单个字符串字段最大保留字符数，默认 4000 */
  maxBodyChars?: number;
  /** 额外需要脱敏的键名（大小写不敏感） */
  redactKeys?: string[];
}

/**
 * Agent / 宿主注入的日志配置（不传 `logger` 时环境变量仍可控制控制台回退）。
 */
export interface SDKLogSink {
  logger?: SDKLogger;
  logLevel?: SDKLogLevel;
  redaction?: LogRedactionConfig;
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
  /** 会话标识；Agent 会在每次模型请求中填入，各适配器自行决定是否映射到 HTTP 请求。 */
  sessionId?: string;
  /** 当前请求使用的 SDK logger。 */
  logger?: SDKLogger;
  /** 当前请求使用的 SDK 日志级别。 */
  logLevel?: SDKLogLevel;
  /** 当前请求使用的日志脱敏策略。 */
  redaction?: LogRedactionConfig;
  /** 单次 run 关联 ID；由 Agent 在流式/非流式回合中注入。 */
  runId?: string;
  /** {@link AgentConfig.agentName} 透传，便于模型层日志关联 */
  agentName?: string;
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
  /** Adapters emit when a discrete thinking block ends (e.g. Anthropic content_block_stop). */
  | 'thinking_block_end'
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
  /** Extended thinking trace: Ollama `think` output, or Anthropic `thinking` content blocks in non-stream `complete`. */
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

  /**
   * 复制当前适配器的连接与行为配置，返回新实例（含相同 model id）。
   * 内置 OpenAI / Anthropic / Ollama 适配器已实现；自定义适配器可选实现。
   */
  clone?(): ModelAdapter;

  /**
   * 替换当前实例使用的模型 id（并更新 {@link name}）；通常在 {@link clone} 之后用于子 Agent 等场景。
   */
  setModel?(modelId: string): void;
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
  /**
   * 与 `Agent` 流式运行传入的 `signal` 同源；工具应在长任务中检查 `signal.aborted` 并协作结束。
   */
  signal?: AbortSignal;
  /**
   * Agent 级环境变量覆盖（来自 {@link AgentConfig.env} 的稀疏 record），不是 `process.env` 的完整快照。
   * 工具需要 spawn 子进程时建议用 {@link import('./process-env-merge.js').mergeProcessEnv} 合并 `context.env` 与当前进程环境。
   */
  env?: Record<string, string>;
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
  parameters: z.ZodType;

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
  | 'thinking_start'
  | 'thinking_end'
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
  | { type: 'thinking_start'; signature?: string }
  | { type: 'thinking'; content: string; signature?: string }
  | { type: 'thinking_end'; content?: string }
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
      /** Number of model rounds completed in this stream call (not message count). */
      iterations: number;
    }
  | {
      type: 'end';
      timestamp: number;
      /**
       * Optional usage (e.g. aborted mid-stream). When a session_summary event was emitted, use its usage for totals.
       */
      usage?: TokenUsage;
      /** Omitted or `complete` = normal completion; `max_iterations` = hit `AgentConfig.maxIterations`. */
      reason?: 'complete' | 'aborted' | 'error' | 'max_iterations';
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

/**
 * 模型适配器在一次请求中可能产出的流式事件类型（与 {@link isModelStreamEventType} 共用此列表，避免与 `switch` 双处维护）。
 * 新增 `StreamEvent` 变体时：若属于模型流，请在此数组中追加对应 `type` 字符串。
 */
export const MODEL_STREAM_EVENT_TYPES = [
  'text_start',
  'text_delta',
  'text_end',
  'tool_call_start',
  'tool_call_delta',
  'tool_call',
  'tool_call_end',
  'thinking_start',
  'thinking',
  'thinking_end',
  'model_usage'
] as const satisfies readonly StreamEventType[];

const MODEL_STREAM_EVENT_TYPE_SET = new Set<StreamEventType>(MODEL_STREAM_EVENT_TYPES);

/**
 * 是否为由模型适配器流式产生的事件类型（用于 `lifecycle.onModelEvent` 过滤）。
 * 排除 `start` / `end` / `session_summary` / `context_compressed` / `tool_result` / `tool_error` 等。
 */
export function isModelStreamEventType(type: StreamEventType): boolean {
  return MODEL_STREAM_EVENT_TYPE_SET.has(type);
}

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
  /**
   * stdio 子进程工作目录（仅 `transport === 'stdio'` 时生效）。
   * 经 `Agent.connectMCP` 且未设置或仅空白时，使用 `AgentConfig.cwd`，再否则为当前进程的 `process.cwd()`。
   * 直接使用 `MCPClient` 且未设置时，spawn 不传 `cwd`，子进程继承父进程工作目录（通常即当时的 `process.cwd()`）。
   */
  cwd?: string;

  /** HTTP 配置 */
  url?: string;
  headers?: Record<string, string>;

  /**
   * 单次 MCP `tools/call` 请求超时（毫秒），映射到 SDK `RequestOptions.timeout`。
   * 省略、≤0 或非有限数：不在请求选项中传入 `timeout`，沿用 SDK 默认（见 `@modelcontextprotocol/sdk` 的 `DEFAULT_REQUEST_TIMEOUT_MSEC`）。
   */
  toolTimeoutMs?: number;

  /**
   * MCP 建连超时（毫秒），用于 `MCPAdapter.addServer`。
   * 省略、≤0 或非有限数时，使用默认值 30000ms。
   */
  connectTimeoutMs?: number;
}

/**
 * Outcome for a single MCP server after {@link Agent.waitForInit} completes.
 */
export interface MCPServerInitializationResult {
  name: string;
  transport: 'stdio' | 'http';
  /** True if the connection succeeded and tools could be registered (when applicable). */
  connected: boolean;
  /** Number of MCP tools registered for this server when `connected` is true. */
  toolsRegistered?: number;
  errorName?: string;
  errorMessage?: string;
}

/**
 * Summary of MCP initialization from {@link Agent.waitForInit}.
 */
export interface MCPInitializationSummary {
  /** True when any MCP servers were configured (via `AgentConfig.mcpServers` or `loadMCPConfigFromFiles`). */
  enabled: boolean;
  servers: MCPServerInitializationResult[];
  /** Count of successfully connected servers (one per unique `name`; first config wins when names repeat). */
  connected: number;
  /** Count of servers that failed to connect (excludes duplicate-name entries skipped after the first). */
  failed: number;
  /**
   * Config entries skipped because an earlier entry already used the same `name`.
   * The first occurrence is still initialized; later duplicates are not started.
   */
  skippedDuplicates: number;
  /**
   * Non-fatal errors from loading `mcp_config.json` files (path not found, parse errors, validation
   * errors, or missing environment variable references). Populated only when `loadMCPConfigFromFiles`
   * is enabled. Each entry has `kind`, `path`, and `message`.
   */
  configErrors?: import('../config/mcp-config.js').MCPConfigLoadError[];
}

/**
 * Result of a single async init step (hooks, skills, subagent disk load).
 */
export interface AgentResourceInitStepResult {
  ok: boolean;
  error?: {
    name: string;
    message: string;
  };
}

/**
 * Result of {@link Agent.waitForInit} after hooks, skills, MCP, and subagent profile loading.
 */
export interface AgentInitResult {
  hooks: AgentResourceInitStepResult;
  skills: AgentResourceInitStepResult;
  mcp: MCPInitializationSummary;
  subagent: AgentResourceInitStepResult;
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
  /**
   * 与 `createModel` 对齐：对各 provider 的统一开关（布尔）。
   */
  thinking?: boolean;
  /**
   * 与 `createModel` 对齐：浅合并进各适配器请求的 JSON。
   */
  extraBody?: Record<string, unknown>;
  /**
   * 推理档位，对应 `createModel` 的 `thinkingLevel`；目前由 Ollama 使用 HTTP `think`，优先于 {@link thinking}；其他适配器可按需采纳或忽略。
   */
  thinkingLevel?: 'low' | 'medium' | 'high';
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

  /**
   * 是否从磁盘加载 Skill 并在默认系统提示中展开 Skills 段落。
   * 未设置或 `true` 时与历史行为一致；`false` 时跳过 {@link SkillRegistry.initialize}，且不向模型暴露 Skills 说明（子 Agent 由 SDK 固定为 `false`）。
   */
  loadSkills?: boolean;

  /** MCP 服务器配置 */
  mcpServers?: MCPServerConfig[];

  /**
   * Opt-in automatic loading of `mcp_config.json` from disk.
   *
   * - `false` (default): no automatic loading; pass `mcpServers` explicitly.
   * - `true`: automatically discover `{userBasePath}/.claude/mcp_config.json` and
   *   `{cwd}/.claude/mcp_config.json`, merging them with explicit `mcpServers`
   *   (explicit entries take precedence over file entries with the same `name`).
   * - `{ configPath: string }`: load a single config file at the given path, then
   *   merge with explicit `mcpServers` (explicit entries take precedence).
   */
  loadMCPConfigFromFiles?: boolean | { configPath: string };

  /**
   * 对当前进程环境的补充与覆盖（合并到 stdio MCP 子进程与内置 Bash 工具子进程；键与 `process.env` 冲突时以本字段为准）。
   * 亦透传给工具的 {@link ToolExecutionContext.env}。与 {@link includeEnvironment}（往 system prompt 注入工作区描述）无关。
   * 使用 `modelConfig` 时，`env` 会一并用于构造模型适配器；若传入现成 `model`，请自行用 `mergeProcessEnv` 解析密钥等。
   * 完整继承会将 `process.env` 中的敏感变量一并带入 MCP/Bash 子进程，由调用方控制。
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

  /**
   * 结构化日志中的逻辑名称（`LogEvent.agentName`），便于多 Agent 场景筛选；未设置时运行时默认 `'Agent'`。
   */
  agentName?: string;

  /** 回调函数 */
  callbacks?: AgentCallbacks;

  /** SDK logger；由宿主应用决定最终输出位置。 */
  logger?: SDKLogger;

  /** SDK 日志级别；省略时可由环境变量控制。 */
  logLevel?: SDKLogLevel;

  /** 日志脱敏与 body 输出控制。 */
  redaction?: LogRedactionConfig;

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

  /**
   * 是否从磁盘加载 Hook：项目 `{hookConfigDir ?? cwd}/.claude/settings.json` 与用户 `{userBasePath}/.claude/settings.json`（未设置 {@link AgentConfig.userBasePath} 时用 `homedir()`）。
   * 默认 `true`（与 Claude Code 一致）。设为 `false` 且未传入 {@link AgentConfig.hookManager} 时，仅当显式设置 {@link AgentConfig.hookConfigDir} 时才创建并加载 `HookManager`。
   */
  loadHookSettingsFromFiles?: boolean;

  /** Subagent 工具行为配置 */
  subagent?: {
    /** 是否启用 Agent 工具，默认 true */
    enabled?: boolean;
    /** 子代理最大深度，默认 1（禁止嵌套） */
    maxDepth?: number;
    /** 并发子代理上限，默认 5 */
    maxParallel?: number;
    /** 子代理默认超时（毫秒），默认 1800000（30 分钟） */
    timeoutMs?: number;
    /**
     * 子代理默认工具白名单：若配置为非空，则子代理工具集优先按此列表在父级注册表中解析（仍受 profile `disallowedTools` 等规则约束）。
     * 未设置或设为空数组时，均不通过本字段收紧工具集——子代理按 `resolveSubagentTools` 的后续规则
     * 继承父级工具池（经 profile `disallowedTools` 过滤）；**不**按 `isDangerous` 过滤。
     */
    defaultAllowedTools?: string[];
    /**
     * 从磁盘加载 `.claude/agents` / `.agent-sdk/agents`（用户与项目目录）；默认 true。
     * 设为 false 时仅使用内置 profile 与 {@link subagent.profiles}。
     */
    loadProfilesFromFiles?: boolean;
    /**
     * 可选覆盖默认 agents 目录；未设置时使用与 Claude Code 类似的约定路径。
     */
    profileConfig?: {
      /** 是否自动从磁盘加载，默认 true；仅当 {@link loadProfilesFromFiles} 非 false 时有效 */
      autoLoad?: boolean;
      /** 项目级 agents 目录（完整路径）；默认 `{cwd}/.claude/agents` */
      workspacePath?: string;
      /** 用户级 agents 目录（完整路径）；默认 `{userBasePath}/.claude/agents` */
      userPath?: string;
      /** 额外要扫描的目录（完整路径），按数组顺序靠后的覆盖同名 profile */
      additionalPaths?: string[];
    };
    /** 程序化注册的 subagent（合并时优先级最高：覆盖磁盘与内置同名 profile） */
    profiles?: SubagentProfile[];
    /**
     * 按 subagent 名称覆盖内置追加 system 片段（例如 explore）；设为空字符串表示不追加内置片段。
     */
    subagentTypePrompts?: Partial<Record<string, string>>;
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
 * Agent 回调：流式事件 + 可选的结构化生命周期观察。
 *
 * - **观察**：`onEvent`、`lifecycle` — 不改变执行结果。
 * - **拦截**：工具策略与 Hook 见 {@link AgentConfig.hookManager} / `hookConfigDir` 与 {@link ToolRegistry}。
 */
export interface AgentCallbacks {
  /** 流式事件回调（与 {@link AgentLifecycleCallbacks.onModelEvent} 互补：后者仅模型侧子集） */
  onEvent?: (event: StreamEvent) => void;

  /** 结构化生命周期观察 */
  lifecycle?: AgentLifecycleCallbacks;

  /** 错误回调；`context` 为可选扩展信息 */
  onError?: (error: Error, context?: AgentErrorContext) => void;
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
