import type { StreamChunk, StreamEvent, TokenUsage } from '../core/types.js';

export interface StreamChunkProcessorOptions {
  /** Emit `text_start` / `text_end` around assistant text deltas (Claude-style content blocks). Default true. */
  emitTextBoundaries?: boolean;
}

/**
 * Stateful conversion from model `StreamChunk` to normalized `StreamEvent`s.
 * Used by `Agent` and `StreamTransformer` so streaming tool JSON and text blocks behave consistently.
 */
export class StreamChunkProcessor {
  private currentToolCall: { id: string; name: string; arguments: string } | null = null;
  private lastUsage: TokenUsage | undefined;
  private inTextBlock = false;
  private readonly emitTextBoundaries: boolean;

  constructor(options?: StreamChunkProcessorOptions) {
    this.emitTextBoundaries = options?.emitTextBoundaries ?? true;
  }

  processChunk(chunk: StreamChunk): StreamEvent[] {
    const events: StreamEvent[] = [];

    const endTextBlockIfNeeded = (): void => {
      if (this.emitTextBoundaries && this.inTextBlock) {
        events.push({ type: 'text_end' });
        this.inTextBlock = false;
      }
    };

    switch (chunk.type) {
      case 'text':
        if (chunk.content) {
          if (this.emitTextBoundaries && !this.inTextBlock) {
            events.push({ type: 'text_start' });
            this.inTextBlock = true;
          }
          events.push({ type: 'text_delta', content: chunk.content });
        }
        break;

      case 'tool_call_start':
        endTextBlockIfNeeded();
        if (this.currentToolCall) {
          events.push(...this.finalizeStreamingToolCall());
        }
        if (chunk.toolCall) {
          this.currentToolCall = {
            id: chunk.toolCall.id,
            name: chunk.toolCall.name,
            arguments: ''
          };
          events.push({
            type: 'tool_call_start',
            id: chunk.toolCall.id,
            name: chunk.toolCall.name
          });
        } else if (chunk.toolCallId && chunk.content) {
          // Anthropic-style: tool name in `content`, id in `toolCallId`
          this.currentToolCall = {
            id: chunk.toolCallId,
            name: chunk.content,
            arguments: ''
          };
          events.push({
            type: 'tool_call_start',
            id: chunk.toolCallId,
            name: chunk.content
          });
        }
        break;

      case 'tool_call_delta':
        if (this.currentToolCall && chunk.toolCallId === this.currentToolCall.id && chunk.content) {
          this.currentToolCall.arguments += chunk.content;
          events.push({
            type: 'tool_call_delta',
            id: this.currentToolCall.id,
            arguments: chunk.content
          });
        } else if (chunk.toolCallId && chunk.content) {
          events.push({
            type: 'tool_call_delta',
            id: chunk.toolCallId,
            arguments: chunk.content
          });
        }
        break;

      case 'tool_call': {
        endTextBlockIfNeeded();
        if (!chunk.toolCall) break;
        const tc = chunk.toolCall;
        if (this.currentToolCall?.id === tc.id) {
          this.currentToolCall = null;
        } else if (this.currentToolCall) {
          events.push(...this.finalizeStreamingToolCall());
        }
        events.push({ type: 'tool_call_end', id: tc.id });
        events.push({
          type: 'tool_call',
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments
        });
        break;
      }

      case 'tool_call_end':
        endTextBlockIfNeeded();
        if (this.currentToolCall) {
          events.push(...this.finalizeStreamingToolCall());
        }
        break;

      case 'thinking':
        endTextBlockIfNeeded();
        if (chunk.content !== undefined) {
          events.push({
            type: 'thinking',
            content: chunk.content,
            signature: chunk.signature
          });
        }
        break;

      case 'error':
        endTextBlockIfNeeded();
        if (chunk.error) {
          events.push({
            type: 'end',
            timestamp: Date.now(),
            reason: 'error',
            error: chunk.error
          });
        }
        break;

      case 'metadata':
        if (chunk.metadata?.usage) {
          const usage = chunk.metadata.usage as TokenUsage;
          this.lastUsage = usage;
          events.push({
            type: 'model_usage',
            usage,
            ...(chunk.usagePhase !== undefined ? { phase: chunk.usagePhase } : {})
          });
        }
        break;

      case 'done':
        break;
    }

    return events;
  }

  /** End open text block and finalize any in-progress streamed tool call. */
  flush(): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this.emitTextBoundaries && this.inTextBlock) {
      events.push({ type: 'text_end' });
      this.inTextBlock = false;
    }
    if (this.currentToolCall) {
      events.push(...this.finalizeStreamingToolCall());
    }
    return events;
  }

  getUsage(): TokenUsage | undefined {
    return this.lastUsage;
  }

  private finalizeStreamingToolCall(): StreamEvent[] {
    if (!this.currentToolCall) return [];
    const { id, name, arguments: argStr } = this.currentToolCall;
    const parsed = this.safeParseJSON(argStr);
    this.currentToolCall = null;
    return [
      { type: 'tool_call_end', id },
      { type: 'tool_call', id, name, arguments: parsed }
    ];
  }

  private safeParseJSON(str: string): unknown {
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }
}
