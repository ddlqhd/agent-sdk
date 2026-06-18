import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnthropicAdapter,
  computeActualInputTokens,
  mergeAnthropicInputUsage,
  resolveAnthropicStreamUsage
} from '../../src/models/anthropic.js';
import type { ModelParams, StreamChunk } from '../../src/core/types.js';

function minimalParams(overrides: Partial<ModelParams> = {}): ModelParams {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides
  };
}

function anthropicSsePayload(events: unknown[]): string {
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
}

function stubFetchWithAnthropicSSE(events: unknown[]): void {
  const encoder = new TextEncoder();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(anthropicSsePayload(events)));
          controller.close();
        }
      })
    })
  );
}

async function collectStream(adapter: AnthropicAdapter): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of adapter.stream(minimalParams())) {
    out.push(c);
  }
  return out;
}

describe('Anthropic stream usage helpers', () => {
  it('computeActualInputTokens adds cache_read to input_tokens', () => {
    expect(
      computeActualInputTokens({ input_tokens: 50, cache_read_input_tokens: 100 })
    ).toBe(150);
  });

  it('mergeAnthropicInputUsage prefers delta input when non-zero', () => {
    const merged = mergeAnthropicInputUsage(
      { input_tokens: 15, output_tokens: 0 },
      { input_tokens: 200, output_tokens: 50 }
    );
    expect(merged.input_tokens).toBe(200);
  });

  it('mergeAnthropicInputUsage falls back to start when delta input_tokens is 0', () => {
    const merged = mergeAnthropicInputUsage(
      { input_tokens: 100 },
      { input_tokens: 0, output_tokens: 50 }
    );
    expect(merged.input_tokens).toBe(100);
  });

  it('mergeAnthropicInputUsage uses start fields when delta omits them (native)', () => {
    const merged = mergeAnthropicInputUsage(
      { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 },
      { output_tokens: 50 }
    );
    expect(merged).toEqual({
      input_tokens: 100,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 5
    });
  });

  it('mergeAnthropicInputUsage keeps start cache when delta echoes input only', () => {
    const merged = mergeAnthropicInputUsage(
      { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 },
      { input_tokens: 100, output_tokens: 50 }
    );
    expect(merged).toEqual({
      input_tokens: 100,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 5
    });
  });

  it('mergeAnthropicInputUsage prefers explicit zero cache on delta over start', () => {
    const merged = mergeAnthropicInputUsage(
      { input_tokens: 15, cache_read_input_tokens: 99 },
      {
        input_tokens: 15,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0
      }
    );
    expect(merged.cache_read_input_tokens).toBe(0);
    expect(merged.cache_creation_input_tokens).toBe(0);
  });

  it('resolveAnthropicStreamUsage merges start and delta (Aliyun wrong start)', () => {
    const resolved = resolveAnthropicStreamUsage(
      { input_tokens: 15, output_tokens: 0 },
      {
        input_tokens: 200,
        output_tokens: 1078,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0
      }
    );
    expect(resolved.inputSource.input_tokens).toBe(200);
    expect(resolved.outputTokens).toBe(1078);
  });

  it('resolveAnthropicStreamUsage uses start input for native delta (output only)', () => {
    const resolved = resolveAnthropicStreamUsage(
      { input_tokens: 100, cache_read_input_tokens: 20 },
      { output_tokens: 50 }
    );
    expect(computeActualInputTokens(resolved.inputSource)).toBe(120);
    expect(resolved.outputTokens).toBe(50);
  });

  it('resolveAnthropicStreamUsage keeps start input when delta input_tokens is 0', () => {
    const resolved = resolveAnthropicStreamUsage(
      { input_tokens: 100, cache_read_input_tokens: 20 },
      { input_tokens: 0, output_tokens: 50 }
    );
    expect(resolved.inputSource.input_tokens).toBe(100);
    expect(computeActualInputTokens(resolved.inputSource)).toBe(120);
  });

  it('resolveAnthropicStreamUsage returns zero outputTokens without losing merged input', () => {
    const resolved = resolveAnthropicStreamUsage(
      { input_tokens: 100, cache_read_input_tokens: 20 },
      { input_tokens: 100, output_tokens: 0 }
    );
    expect(computeActualInputTokens(resolved.inputSource)).toBe(120);
    expect(resolved.outputTokens).toBe(0);
  });
});

describe('AnthropicAdapter stream usage emission', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not emit metadata on message_start; emits input+output on message_delta (native)', async () => {
    stubFetchWithAnthropicSSE([
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude',
          content: [],
          usage: { input_tokens: 100, output_tokens: 0 }
        }
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hi' }
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 50 }
      },
      { type: 'message_stop' }
    ]);

    const chunks = await collectStream(new AnthropicAdapter({ apiKey: 'sk-ant' }));
    const metadata = chunks.filter(c => c.type === 'metadata');
    expect(metadata).toHaveLength(2);

    const textIdx = chunks.findIndex(c => c.type === 'text');
    const firstMetaIdx = chunks.findIndex(c => c.type === 'metadata');
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(firstMetaIdx).toBeGreaterThan(textIdx);

    expect(metadata[0]).toMatchObject({
      usagePhase: 'input',
      metadata: { usage: { promptTokens: 100, completionTokens: 0, totalTokens: 100 } }
    });
    expect(metadata[1]).toMatchObject({
      usagePhase: 'output',
      metadata: { usage: { promptTokens: 0, completionTokens: 50, totalTokens: 50 } }
    });
  });

  it('uses merged input from message_delta when start input is wrong (Aliyun)', async () => {
    stubFetchWithAnthropicSSE([
      {
        type: 'message_start',
        message: {
          id: 'msg_xxx',
          type: 'message',
          role: 'assistant',
          model: 'qwen3.7-plus',
          content: [],
          usage: { input_tokens: 15, output_tokens: 0 }
        }
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: {
          input_tokens: 200,
          output_tokens: 1078,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        }
      },
      { type: 'message_stop' }
    ]);

    const chunks = await collectStream(new AnthropicAdapter({ apiKey: 'sk-ant' }));
    const metadata = chunks.filter(c => c.type === 'metadata');
    expect(metadata).toHaveLength(2);
    expect(metadata[0]).toMatchObject({
      usagePhase: 'input',
      metadata: { usage: { promptTokens: 200, completionTokens: 0, totalTokens: 200 } }
    });
    expect(metadata[1]).toMatchObject({
      usagePhase: 'output',
      metadata: { usage: { promptTokens: 0, completionTokens: 1078, totalTokens: 1078 } }
    });
  });

  it('matches Aliyun sample when start and delta input agree', async () => {
    stubFetchWithAnthropicSSE([
      {
        type: 'message_start',
        message: {
          id: 'msg_xxx',
          type: 'message',
          role: 'assistant',
          model: 'qwen3.7-plus',
          content: [],
          usage: { input_tokens: 15, output_tokens: 0 }
        }
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: {
          input_tokens: 15,
          output_tokens: 1078,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        }
      },
      { type: 'message_stop' }
    ]);

    const chunks = await collectStream(new AnthropicAdapter({ apiKey: 'sk-ant' }));
    const inputMeta = chunks.find(c => c.type === 'metadata' && c.usagePhase === 'input');
    const outputMeta = chunks.find(c => c.type === 'metadata' && c.usagePhase === 'output');
    expect(inputMeta?.metadata?.usage).toMatchObject({
      promptTokens: 15,
      completionTokens: 0,
      totalTokens: 15
    });
    expect(outputMeta?.metadata?.usage).toMatchObject({
      promptTokens: 0,
      completionTokens: 1078,
      totalTokens: 1078
    });
  });

  it('maps cache fields from merged message_delta usage', async () => {
    stubFetchWithAnthropicSSE([
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'qwen-plus',
          content: [],
          usage: { input_tokens: 10, output_tokens: 0 }
        }
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: {
          input_tokens: 50,
          output_tokens: 20,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 10
        }
      },
      { type: 'message_stop' }
    ]);

    const chunks = await collectStream(new AnthropicAdapter({ apiKey: 'sk-ant' }));
    const inputMeta = chunks.find(c => c.type === 'metadata' && c.usagePhase === 'input');
    expect(inputMeta?.metadata?.usage).toMatchObject({
      promptTokens: 160,
      cacheReadTokens: 100,
      cacheWriteTokens: 10
    });
  });

  it('emits input metadata only when message_delta has output_tokens zero', async () => {
    stubFetchWithAnthropicSSE([
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude',
          content: [],
          usage: { input_tokens: 80, output_tokens: 0 }
        }
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { input_tokens: 80, output_tokens: 0 }
      },
      { type: 'message_stop' }
    ]);

    const chunks = await collectStream(new AnthropicAdapter({ apiKey: 'sk-ant' }));
    const metadata = chunks.filter(c => c.type === 'metadata');
    expect(metadata).toHaveLength(1);
    expect(metadata[0]).toMatchObject({
      usagePhase: 'input',
      metadata: { usage: { promptTokens: 80, completionTokens: 0, totalTokens: 80 } }
    });
  });

  it('emits no metadata when stream has no usage events', async () => {
    stubFetchWithAnthropicSSE([
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hi' }
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' }
    ]);

    const chunks = await collectStream(new AnthropicAdapter({ apiKey: 'sk-ant' }));
    expect(chunks.some(c => c.type === 'metadata')).toBe(false);
  });
});
