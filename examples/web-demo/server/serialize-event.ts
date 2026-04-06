import type { StreamEvent } from '@ddlqhd/agent-sdk';

function errorToJson(err: Error): Record<string, unknown> {
  return {
    name: err.name,
    message: err.message,
    stack: err.stack
  };
}

/**
 * Convert StreamEvent to JSON-safe object for WebSocket.
 */
export function serializeStreamEvent(event: StreamEvent): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: event.type,
    ...('streamEventId' in event && event.streamEventId
      ? { streamEventId: event.streamEventId }
      : {}),
    ...('iteration' in event && event.iteration !== undefined ? { iteration: event.iteration } : {}),
    ...('sessionId' in event && event.sessionId ? { sessionId: event.sessionId } : {})
  };

  switch (event.type) {
    case 'tool_error':
      return { ...base, toolCallId: event.toolCallId, error: errorToJson(event.error) };
    case 'text_delta':
      return { ...base, content: event.content };
    case 'text_start':
    case 'text_end':
      return { ...base, ...('content' in event && event.content !== undefined ? { content: event.content } : {}) };
    case 'thinking':
      return { ...base, content: event.content, ...('signature' in event ? { signature: event.signature } : {}) };
    case 'tool_call_start':
      return { ...base, id: event.id, name: event.name };
    case 'tool_call_delta':
      return { ...base, id: event.id, arguments: event.arguments };
    case 'tool_call':
      return { ...base, id: event.id, name: event.name, arguments: event.arguments };
    case 'tool_call_end':
      return { ...base, id: event.id };
    case 'tool_result':
      return { ...base, toolCallId: event.toolCallId, result: event.result };
    case 'start':
      return { ...base, timestamp: event.timestamp };
    case 'end':
      return {
        ...base,
        timestamp: event.timestamp,
        usage: event.usage,
        ...('reason' in event && event.reason !== undefined ? { reason: event.reason } : {}),
        ...('partialContent' in event && event.partialContent !== undefined
          ? { partialContent: event.partialContent }
          : {}),
        ...('error' in event && event.error
          ? { error: errorToJson(event.error as Error) }
          : {})
      };
    case 'model_usage':
      return {
        ...base,
        usage: event.usage,
        ...('phase' in event && event.phase !== undefined ? { phase: event.phase } : {})
      };
    case 'session_summary':
      return {
        ...base,
        usage: event.usage,
        iterations: event.iterations
      };
    case 'context_compressed':
      return { ...base, stats: event.stats };
    default:
      return { ...base, ...(event as unknown as Record<string, unknown>) };
  }
}
