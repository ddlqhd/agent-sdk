/**
 * Agent lifecycle callbacks — **observation only**.
 *
 * Use these for UI, tracing, auditing, and metrics. They must not change execution outcomes.
 * **Interception** (block tool calls, rewrite inputs, policy) belongs to {@link HookManager}
 * and {@link ToolRegistry} execution policy, not to these callbacks.
 *
 * @module
 */

import type { HookEventType } from '../tools/hooks/types.js';
import type {
  Message,
  StreamEvent,
  TokenUsage,
  ToolCall,
  ToolResult
} from './types.js';

/** Shared fields on run-level observation contexts */
export interface AgentRunContext {
  sessionId?: string;
  cwd?: string;
}

export interface AgentRunStartContext extends AgentRunContext {
  /** Original user input length before skill processing */
  inputLength: number;
  /** Input length after skill / template processing */
  processedInputLength: number;
  /** Session id from {@link StreamOptions.sessionId} when resuming */
  resumeSessionId?: string;
}

export type AgentRunEndReason =
  | 'complete'
  | 'aborted'
  | 'error'
  | 'max_iterations';

export interface AgentRunEndContext extends AgentRunContext {
  reason: AgentRunEndReason;
  iterations: number;
  usage?: TokenUsage;
  error?: Error;
}

export type SystemMessageSource = 'default_prompt' | 'runtime_prompt' | 'memory';

export type UserMessageSource = 'raw_input' | 'processed_input' | 'interruption_marker';

export interface MessageObservationContext extends AgentRunContext {
  iteration?: number;
}

export interface ModelRequestStartContext extends AgentRunContext {
  iteration: number;
  messageCount: number;
  toolCount: number;
  temperature?: number;
  maxTokens?: number;
  includeRawStreamEvents?: boolean;
}

/** Base context for tool execution observation (Agent layer) */
export interface ToolExecutionBaseContext extends AgentRunContext {
  iteration: number;
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  projectDir?: string;
  agentDepth?: number;
}

export interface ToolExecutionEndContext extends ToolExecutionBaseContext {
  durationMs: number;
  isError: boolean;
  /** Set when the tool handler threw (distinct from `isError` result) */
  executionError?: Error;
}

export interface ToolResultObservationContext extends ToolExecutionEndContext {
  result: ToolResult;
}

/**
 * Observation callbacks for the tool hook pipeline inside {@link ToolRegistry}.
 * Does not replace {@link HookManager}; it only surfaces what happened.
 */
export interface ToolHookObserver {
  /** Invoked immediately before a hook pipeline step runs for the given event type */
  onHookStart?: (ctx: HookObservationContext) => void;
  /** Invoked after `preToolUse` with the aggregate allow/deny decision */
  onHookDecision?: (ctx: HookDecisionContext) => void;
  /**
   * Reserved for hook pipeline failures surfaced as `Error` (e.g. future hook instrumentation).
   * Tool handler errors use {@link AgentLifecycleCallbacks.onToolExecutionError}.
   */
  onHookError?: (error: Error, ctx: HookObservationContext) => void;
}

export interface HookObservationContext {
  eventType: HookEventType;
  toolName: string;
  toolCallId?: string;
  projectDir?: string;
}

export interface HookDecisionContext extends HookObservationContext {
  allowed: boolean;
  reason?: string;
}

/** Optional second argument to {@link AgentCallbacks.onError} and lifecycle error hooks */
export interface AgentErrorContext {
  phase:
    | 'run'
    | 'model'
    | 'tool'
    | 'hook'
    | 'persistence'
    | 'lifecycle_callback';
  iteration?: number;
  toolName?: string;
  toolCallId?: string;
  cause?: unknown;
}

/**
 * Structured lifecycle callbacks for {@link Agent}.
 *
 * Prefer these over ad-hoc parsing of {@link StreamEvent} when you need stable, typed observation points.
 */
export interface AgentLifecycleCallbacks {
  // --- Run / session ---
  onRunStart?: (ctx: AgentRunStartContext) => void;
  onRunEnd?: (ctx: AgentRunEndContext) => void;
  onRunAbort?: (ctx: AgentRunContext & { iteration?: number }) => void;
  onSessionCreate?: (ctx: { sessionId?: string }) => void;
  onSessionResume?: (ctx: { sessionId: string; messageCount: number }) => void;

  onIterationStart?: (
    ctx: { iteration: number; messageCount: number; toolCount: number } & AgentRunContext
  ) => void;
  onIterationEnd?: (
    ctx: { iteration: number; hadToolCalls: boolean } & AgentRunContext
  ) => void;

  onContextCompressed?: (
    ctx: {
      iteration: number;
      stats: { originalMessageCount: number; compressedMessageCount: number; durationMs: number };
    } & AgentRunContext
  ) => void;

  // --- Messages ---
  onSystemMessage?: (
    message: Message,
    source: SystemMessageSource,
    ctx?: MessageObservationContext
  ) => void;
  onUserMessage?: (
    message: Message,
    source: UserMessageSource,
    ctx?: MessageObservationContext
  ) => void;
  onAssistantMessage?: (
    message: Message,
    ctx?: MessageObservationContext & { iteration: number }
  ) => void;
  onToolMessage?: (
    message: Message,
    ctx?: MessageObservationContext & { iteration: number; toolCallId: string }
  ) => void;
  onMessagePersist?: (ctx: { messageCount: number } & AgentRunContext) => void;

  // --- Model ---
  onModelRequestStart?: (ctx: ModelRequestStartContext) => void;
  /**
   * Fired for stream events that originate from the model adapter (see `isModelStreamEventType` / `MODEL_STREAM_EVENT_TYPES`).
   * The same events are also delivered to {@link AgentCallbacks.onEvent}; subscribe to one or dedupe if both are set.
   */
  onModelEvent?: (event: StreamEvent) => void;
  onModelUsage?: (
    ctx: {
      usage: TokenUsage;
      iteration?: number;
      phase?: 'input' | 'output';
    } & AgentRunContext
  ) => void;
  /** After the model stream for this iteration is fully flushed, before the assistant message is appended */
  onModelRequestEnd?: (ctx: { iteration: number } & AgentRunContext) => void;
  /** When the model stream terminates with {@link StreamEvent} `end` and `reason: 'error'` */
  onModelRequestError?: (error: Error, ctx: AgentErrorContext & { iteration: number }) => void;

  // --- Tools ---
  onToolCallPlanned?: (toolCall: ToolCall, ctx: { iteration: number } & AgentRunContext) => void;
  onToolExecutionStart?: (ctx: ToolExecutionBaseContext) => void;
  onToolExecutionEnd?: (ctx: ToolExecutionEndContext) => void;
  onToolResult?: (ctx: ToolResultObservationContext) => void;
  onToolExecutionError?: (error: Error, ctx: AgentErrorContext) => void;

  /** Bridges to {@link ToolRegistry} hook observation */
  hooks?: ToolHookObserver;

  /** Non-fatal agent-level errors (e.g. stream failure) */
  onAgentError?: (error: Error, ctx: AgentErrorContext) => void;
}
