import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicAdapter } from '../../src/models/anthropic.js';
import type { ModelParams } from '../../src/core/types.js';

function minimalUserParams(overrides: Partial<ModelParams> = {}): ModelParams {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides
  };
}

function anthropicSsePayload(events: unknown[]): string {
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
}

describe('AnthropicAdapter thinking signature', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stream captures signature_delta and does not propagate empty start signature', async () => {
    const encoder = new TextEncoder();
    const payload = anthropicSsePayload([
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' }
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'step one' }
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig-from-delta' }
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: '' }
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'answer' }
      },
      { type: 'content_block_stop', index: 1 }
    ]);

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

    const thinkingChunks: Array<{ content?: string; signature?: string }> = [];
    for await (const chunk of new AnthropicAdapter({ apiKey: 'sk-test' }).stream(minimalUserParams())) {
      if (chunk.type === 'thinking') {
        thinkingChunks.push({ content: chunk.content, signature: chunk.signature });
      }
    }

    expect(thinkingChunks[0]).toEqual({ content: undefined, signature: undefined });
    expect(thinkingChunks[1]).toEqual({ content: 'step one', signature: undefined });
    expect(thinkingChunks[2]).toEqual({ content: undefined, signature: 'sig-from-delta' });
    expect(thinkingChunks.some(c => c.signature === '')).toBe(false);
    expect(thinkingChunks.some(c => c.signature === 'sig-from-delta')).toBe(true);
  });

  it('filters thinking blocks without valid signature from outbound messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 1 }
        })
      })
    );

    const adapter = new AnthropicAdapter({ apiKey: 'sk-test' });
    await adapter.complete({
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'internal', signature: '' },
            { type: 'text', text: 'prior reply' }
          ]
        },
        { role: 'user', content: 'follow up' }
      ]
    });

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const assistantMsg = body.messages.find(m => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toEqual([{ type: 'text', text: 'prior reply' }]);
  });

  it('preserves thinking blocks with valid signature in outbound messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 1 }
        })
      })
    );

    const thinkingBlock = {
      type: 'thinking' as const,
      thinking: 'trace',
      signature: 'sig-valid'
    };

    const adapter = new AnthropicAdapter({ apiKey: 'sk-test' });
    await adapter.complete({
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [thinkingBlock, { type: 'text', text: 'prior reply' }]
        },
        { role: 'user', content: 'follow up' }
      ]
    });

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const assistantMsg = body.messages.find(m => m.role === 'assistant');
    expect(assistantMsg!.content).toEqual([thinkingBlock, { type: 'text', text: 'prior reply' }]);
  });
});
