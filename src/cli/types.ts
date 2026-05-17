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

  /**
   * Agent SDK 结构化日志级别（skills / memory / 子 agent 配置等）。
   * CLI `chat`/`run` 未指定时由 CLI 填入默认值以便在终端可见。
   */
  logLevel?: SDKLogLevel;

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
}
