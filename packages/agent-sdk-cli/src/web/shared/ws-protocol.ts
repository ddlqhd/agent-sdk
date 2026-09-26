/**
 * WebSocket message types (browser + server).
 */

import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  ForkSessionResult,
  RewindSessionResult,
  SessionCheckpoint,
  SessionUsageSummary,
  TokenUsage,
  TurnStats
} from '@ddlqhd/agent-sdk';
import type { ChatHistoryItem } from './message-text.js';

export type ModelProvider = 'openai' | 'anthropic' | 'ollama';

export type ClientMessage =
  | { type: 'hello'; clientVersion?: string }
  | {
      type: 'configure';
      provider: ModelProvider;
      model: string;
      temperature?: number;
      /** 覆盖 ContextManager 的上下文窗口（tokens）；仅在与上下文压缩一并启用时生效 */
      contextLength?: number;
      storage: 'memory' | 'jsonl';
      /** When true, hide Bash and unregister remaining isDangerous tools after init */
      safeToolsOnly?: boolean;
      memory?: boolean;
      /** Omit or true: context compression on; false: off */
      contextManagement?: boolean;
      /** Optional path to MCP JSON (Claude Desktop format), absolute or relative to cwd */
      mcpConfigPath?: string;
      /** Working directory for skills / CLAUDE.md / tool cwd */
      cwd?: string;
      /** Base for ~/.claude/sessions etc.; defaults to CLI `--user-base-path` or homedir */
      userBasePath?: string;
      /** Maps to AgentModelConfig.thinking (omit for provider default). */
      thinking?: boolean;
      /** Maps to AgentModelConfig.thinkingLevel (omit for default; adapters use when supported). */
      thinkingLevel?: 'low' | 'medium' | 'high';
      /**
       * Model API base URL.
       * A non-empty string overrides the server default.
       * `null` clears a custom URL (provider env / built-in default).
       * Omit to keep the server default (`--base-url` or saved settings).
       */
      baseUrl?: string | null;
      /**
       * Model API key.
       * A non-empty string overrides the server default.
       * `null` clears a saved key (fall back to the provider environment variable).
       * Omit to keep the server default (`--api-key` or saved settings).
       */
      apiKey?: string | null;
      /** When true, write configure fields (including the API key in plaintext) to the user settings file. */
      persist?: boolean;
    }
  | { type: 'chat'; text: string; sessionId?: string; requestId: string; forkSession?: boolean }
  | { type: 'chat_run'; text: string; sessionId?: string; requestId: string; forkSession?: boolean }
  | { type: 'cancel'; requestId: string }
  | { type: 'sessions:list' }
  | { type: 'sessions:new'; sessionId?: string }
  | { type: 'sessions:resume'; sessionId: string }
  | { type: 'sessions:delete'; sessionId: string }
  | { type: 'sessions:checkpoints'; sessionId?: string }
  | {
      type: 'sessions:rewind';
      sessionId?: string;
      checkpointId?: string;
      userTurnIndex?: number;
    }
  | {
      type: 'sessions:fork';
      sessionId?: string;
      checkpointId?: string;
      userTurnIndex?: number;
      newSessionId?: string;
    }
  | { type: 'ask_user_question_reply'; requestId: string; answers: AskUserQuestionAnswer[] };

export type SerializedStreamEvent = Record<string, unknown>;

/** Server-side defaults (from `agent-sdk web` flags) sent on handshake. */
export interface WebUiDefaults {
  cwd: string;
  userBasePath: string;
  mcpConfigPath?: string;
  provider?: ModelProvider;
  model?: string;
  /** Saved or CLI API base URL, used to prefill the settings field. */
  baseUrl?: string;
  /** True when the server holds an API key. The key itself is not sent. */
  hasApiKey?: boolean;
  /** Masked hint such as `…ab12`, present only when `hasApiKey` is true. */
  apiKeyHint?: string;
  temperature?: number;
  contextLength?: number;
  thinking?: boolean;
  thinkingLevel?: 'low' | 'medium' | 'high';
  storage?: 'memory' | 'jsonl';
  safeToolsOnly?: boolean;
  memory?: boolean;
  contextManagement?: boolean;
}

export type ServerMessage =
  | { type: 'hello_ok'; defaults?: WebUiDefaults }
  | { type: 'ready'; warnings?: string[]; sessionId?: string | null }
  | { type: 'error'; message: string; detail?: string }
  | { type: 'stream_event'; event: SerializedStreamEvent }
  | {
      type: 'chat_done';
      requestId: string;
      sessionId: string;
      finalText: string;
      usage?: TokenUsage;
      /** 本轮指标（TPS / token / 缓存命中率 / 耗时）；无 token 消耗的轮次可能缺失 */
      turn?: TurnStats;
      /** 会话累计指标（输入框下方）；配置错误等早退分支不带 */
      session?: SessionUsageSummary;
    }
  | { type: 'session_stats'; sessionId: string; stats: SessionUsageSummary }
  | { type: 'sessions:list'; sessions: SessionListItem[] }
  | { type: 'sessions:new'; sessionId: string }
  | { type: 'sessions:deleted'; sessionId: string }
  | { type: 'sessions:checkpoints'; sessionId: string; checkpoints: SessionCheckpoint[] }
  | {
      type: 'sessions:rewind';
      sessionId: string;
      result: RewindSessionResult;
      messages: ChatHistoryItem[];
    }
  | {
      type: 'sessions:fork';
      sessionId: string;
      sourceSessionId: string;
      result: ForkSessionResult;
      messages: ChatHistoryItem[];
    }
  | { type: 'sessions:history'; sessionId: string; messages: ChatHistoryItem[] }
  | { type: 'ask_user_question'; requestId: string; questions: AskUserQuestionItem[] };

export interface SessionListItem {
  id: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** First user question, already truncated for the sidebar. */
  title?: string;
}
