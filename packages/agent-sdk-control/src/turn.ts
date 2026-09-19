import type { Agent, StreamEvent, TokenUsage } from '@ddlqhd/agent-sdk';
import type { TurnSink } from './ports.js';

export interface RunTurnOptions {
  agent: Agent;
  text: string;
  sessionId?: string;
  signal?: AbortSignal;
  forkSession?: boolean;
  sink?: TurnSink;
}

export interface TurnResult {
  finalText: string;
  usage?: TokenUsage;
  endReason?: string;
  aborted: boolean;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name;
  return name === 'AbortError';
}

/**
 * Shared turn loop for CLI / Web / ACP. Adapters supply a {@link TurnSink}.
 */
export async function runTurn(options: RunTurnOptions): Promise<TurnResult> {
  const { agent, text, sessionId, signal, forkSession, sink } = options;
  sink?.resetTurn?.();

  let finalText = '';
  let usage: TokenUsage | undefined;
  let endReason: string | undefined;

  try {
    for await (const event of agent.stream(text, { sessionId, signal, forkSession })) {
      if (event.type === 'text_delta') {
        finalText += event.content;
      }
      if (event.type === 'session_summary') {
        usage = event.usage;
      }
      if (event.type === 'end') {
        endReason = event.reason;
        if (event.usage !== undefined) {
          usage = event.usage;
        }
      }
      await sink?.onEvent(event);
    }
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      return { finalText, usage, endReason: endReason ?? 'aborted', aborted: true };
    }
    throw error;
  }

  return {
    finalText,
    usage,
    endReason,
    aborted: endReason === 'aborted'
  };
}

export function isEndStreamEvent(
  event: StreamEvent
): event is StreamEvent & { type: 'end' } {
  return event.type === 'end';
}
