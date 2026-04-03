/**
 * WebSocket message types (browser + server).
 */

import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  TokenUsage
} from 'agent-sdk';

export type ModelProvider = 'openai' | 'anthropic' | 'ollama';

export type ClientMessage =
  | { type: 'hello'; clientVersion?: string }
  | {
      type: 'configure';
      provider: ModelProvider;
      model: string;
      temperature?: number;
      maxTokens?: number;
      storage: 'memory' | 'jsonl';
      /** When true, strip isDangerous tools and add demo calculator */
      safeToolsOnly?: boolean;
      memory?: boolean;
      /** Omit or true: context compression on; false: off */
      contextManagement?: boolean;
      /** Optional path to MCP JSON (Claude Desktop format), absolute or relative to demo root */
      mcpConfigPath?: string;
      /** Working directory for skills / CLAUDE.md / tool cwd */
      cwd?: string;
      /** Base for ~/.claude/sessions etc.; defaults to temp under demo */
      userBasePath?: string;
      /** Ollama only: `/api/chat` `think` (omit = server default). */
      ollamaThink?: boolean | 'low' | 'medium' | 'high';
    }
  | { type: 'chat'; text: string; sessionId?: string; requestId: string }
  | { type: 'chat_run'; text: string; sessionId?: string; requestId: string }
  | { type: 'cancel'; requestId: string }
  | { type: 'sessions:list' }
  | { type: 'sessions:new'; sessionId?: string }
  | { type: 'sessions:resume'; sessionId: string }
  | { type: 'ask_user_question_reply'; requestId: string; answers: AskUserQuestionAnswer[] };

export type SerializedStreamEvent = Record<string, unknown>;

export type ServerMessage =
  | { type: 'hello_ok' }
  | { type: 'ready'; warnings?: string[]; sessionId?: string | null }
  | { type: 'error'; message: string; detail?: string }
  | { type: 'stream_event'; event: SerializedStreamEvent }
  | {
      type: 'chat_done';
      requestId: string;
      sessionId: string;
      finalText: string;
      usage?: TokenUsage;
    }
  | { type: 'sessions:list'; sessions: SessionListItem[] }
  | { type: 'sessions:new'; sessionId: string }
  | { type: 'ask_user_question'; requestId: string; questions: AskUserQuestionItem[] };

export interface SessionListItem {
  id: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}
