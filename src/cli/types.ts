import type { SDKLogLevel } from '../core/types.js';

/**
 * CLI 命令的通用 Commander flag 形状（仅供 `src/cli/` / `bin` 入口使用）。
 * 不属于 `@ddlqhd/agent-sdk` 的根入口运行时契约。
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

  /** 输出格式（headless `-p`） */
  output?: 'text' | 'json' | 'markdown';

  /** Claude Code alias for {@link output}; normalized in action. */
  outputFormat?: string;

  /** Headless print mode flag (`-p` / `--print`). */
  print?: string | boolean;

  /** Skip auto-loading hooks, skills, memory, MCP discovery, subagent profiles. */
  bare?: boolean;

  /** Auto-approved tools (comma-separated on CLI). Maps to AgentConfig.allowedTools. */
  allowedTools?: string[];

  /** 是否流式 */
  stream?: boolean;

  /** 会话 ID */
  session?: string;

  /** 恢复最近一次会话（CLI chat/-p） */
  resume?: boolean;

  /** 详细输出 */
  verbose?: boolean;

  /**
   * Agent SDK 结构化日志级别（skills / memory / 子 agent 配置等）。
   * CLI `chat`/`-p` 未指定时由 CLI 填入默认值以便在终端可见。
   */
  logLevel?: SDKLogLevel;

  /** 系统提示词 */
  system?: string;

  /** SDK JSONL 日志文件路径 */
  logFile?: string;

  /** MCP 配置文件路径 */
  mcpConfig?: string;

  /** 用户级基础路径，默认 ~ (homedir) */
  userBasePath?: string;

  /** 工作目录 */
  cwd?: string;

  /** 与 `AgentModelConfig.thinking` 对齐的统一开关。 */
  thinking?: boolean;

  /** 与 `AgentModelConfig.thinkingLevel` 对齐；由各 adapter 按需使用。 */
  thinkingLevel?: 'low' | 'medium' | 'high';

  /** Stream/-p 前 fork 当前 session（需 --session 或 --resume） */
  fork?: boolean;

  /** Stream/-p 前 fork 到指定 checkpoint */
  forkCheckpointId?: string;

  /** Stream/-p 前 fork 到 0-based user turn */
  forkUserTurnIndex?: number;
}
