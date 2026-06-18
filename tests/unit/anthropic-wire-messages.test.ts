import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AnthropicAdapter,
  buildAnthropicWireMessages,
  computeActualInputTokens
} from '../../src/models/anthropic.js';
import type { Message, ModelParams } from '../../src/core/types.js';

function minimalUserParams(overrides: Partial<ModelParams> = {}): ModelParams {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides
  };
}

describe('buildAnthropicWireMessages', () => {
  it('merges parallel tool results into one user message', () => {
    const messages: Message[] = [
      { role: 'user', content: 'run tools' },
      {
        role: 'assistant',
        content: 'calling',
        toolCalls: [
          { id: 'tu_a', name: 'Read', arguments: { path: 'a.txt' } },
          { id: 'tu_b', name: 'Read', arguments: { path: 'b.txt' } }
        ]
      },
      { role: 'tool', toolCallId: 'tu_a', content: 'body-a' },
      { role: 'tool', toolCallId: 'tu_b', content: 'body-b' }
    ];

    const wire = buildAnthropicWireMessages(messages) as Array<{
      role: string;
      content: unknown;
    }>;

    expect(wire).toHaveLength(3);
    expect(wire[1]!.role).toBe('assistant');
    expect(wire[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu_a', content: 'body-a' },
        { type: 'tool_result', tool_use_id: 'tu_b', content: 'body-b' }
      ]
    });
  });

  it('maps tool isError to tool_result.is_error', () => {
    const wire = buildAnthropicWireMessages([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tu_1', name: 'Bash', arguments: {} }]
      },
      { role: 'tool', toolCallId: 'tu_1', content: 'failed', isError: true }
    ]) as Array<{ role: string; content: unknown[] }>;

    expect(wire[1]!.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'tu_1',
      is_error: true
    });
  });

  it('preserves thinking block with empty text when signature is present', () => {
    const wire = buildAnthropicWireMessages([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig-omitted' },
          { type: 'text', text: 'answer' }
        ]
      },
      { role: 'user', content: 'follow up' }
    ]) as Array<{ role: string; content: unknown[] }>;

    const assistant = wire.find(m => m.role === 'assistant');
    expect(assistant!.content[0]).toEqual({
      type: 'thinking',
      thinking: '',
      signature: 'sig-omitted'
    });
  });
});

describe('computeActualInputTokens', () => {
  it('includes cache_creation in total prompt tokens', () => {
    expect(
      computeActualInputTokens({
        input_tokens: 50,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 10
      })
    ).toBe(160);
  });
});

describe('AnthropicAdapter request wiring', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends stop_sequences from ModelParams.stopSequences', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'x' }],
          usage: { input_tokens: 1, output_tokens: 1 }
        })
      })
    );
    await new AnthropicAdapter({ apiKey: 'sk-test' }).complete(
      minimalUserParams({ stopSequences: ['END', 'STOP'] })
    );

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string
    ) as Record<string, unknown>;
    expect(body.stop_sequences).toEqual(['END', 'STOP']);
  });

  it('stream yields error chunk on SSE error event', async () => {
    const encoder = new TextEncoder();
    const payload =
      'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(payload));
            controller.close();
          }
        })
      })
    );

    const chunks = [];
    for await (const chunk of new AnthropicAdapter({ apiKey: 'sk-test' }).stream(
      minimalUserParams()
    )) {
      chunks.push(chunk);
    }

    const err = chunks.find(c => c.type === 'error');
    expect(err?.error?.message).toContain('overloaded_error');
    expect(err?.error?.message).toContain('Overloaded');
  });
});
