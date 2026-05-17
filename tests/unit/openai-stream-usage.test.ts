import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter } from '../../src/models/openai.js';
import type { ModelParams, StreamChunk } from '../../src/core/types.js';

function minimalParams(overrides: Partial<ModelParams> = {}): ModelParams {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides
  };
}

function sseLines(chunks: Array<Record<string, unknown>>): string {
  const parts = chunks.map(c => `data: ${JSON.stringify(c)}`);
  return `${parts.join('\n')}\n\ndata: [DONE]\n`;
}

function stubFetchWithSSE(payload: string): void {
  const encoder = new TextEncoder();
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
}

async function collectStream(adapter: OpenAIAdapter): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of adapter.stream(minimalParams())) {
    out.push(c);
  }
  return out;
}

describe('OpenAIAdapter stream usage emission', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('emits exactly one metadata chunk for standard OpenAI (usage on final empty-choices chunk)', async () => {
    stubFetchWithSSE(
      sseLines([
        { choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { content: ' world' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }
      ])
    );

    const chunks = await collectStream(new OpenAIAdapter({ apiKey: 'sk' }));
    const metadata = chunks.filter(c => c.type === 'metadata');
    expect(metadata).toHaveLength(1);
    expect(metadata[0]).toMatchObject({
      type: 'metadata',
      usagePhase: 'output',
      metadata: { usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 } }
    });

    const order = chunks.map(c => c.type);
    expect(order.indexOf('metadata')).toBeLessThan(order.indexOf('done'));
  });

  it('collapses per-chunk cumulative usage from compatible servers (vLLM/SGLang) to a single metadata chunk with the final values', async () => {
    stubFetchWithSSE(
      sseLines([
        {
          choices: [{ index: 0, delta: { content: 'A' }, finish_reason: null }],
          usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101 }
        },
        {
          choices: [{ index: 0, delta: { content: 'B' }, finish_reason: null }],
          usage: { prompt_tokens: 100, completion_tokens: 11, total_tokens: 111 }
        },
        {
          choices: [{ index: 0, delta: { content: 'C' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 21, total_tokens: 121 }
        }
      ])
    );

    const chunks = await collectStream(new OpenAIAdapter({ apiKey: 'sk' }));
    const metadata = chunks.filter(c => c.type === 'metadata');
    expect(metadata).toHaveLength(1);
    expect(metadata[0]).toMatchObject({
      type: 'metadata',
      metadata: { usage: { promptTokens: 100, completionTokens: 21, totalTokens: 121 } }
    });

    // Text deltas remain interleaved without metadata between them, so downstream consumers
    // (CLI formatter, Agent.applyModelStreamEventToState) won't multiply input/output tokens.
    const types = chunks.map(c => c.type);
    const textIdx = types
      .map((t, i) => (t === 'text' ? i : -1))
      .filter(i => i >= 0);
    const metadataIdx = types.indexOf('metadata');
    expect(textIdx.every(i => i < metadataIdx)).toBe(true);
  });

  it('emits no metadata chunk when no usage is reported by the server', async () => {
    stubFetchWithSSE(
      sseLines([
        { choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }] }
      ])
    );

    const chunks = await collectStream(new OpenAIAdapter({ apiKey: 'sk' }));
    expect(chunks.some(c => c.type === 'metadata')).toBe(false);
  });
});
