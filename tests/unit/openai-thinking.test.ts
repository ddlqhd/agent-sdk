import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIAdapter } from '../../src/models/openai.js';
import { createModel } from '../../src/models/index.js';
import type { ModelParams } from '../../src/core/types.js';

function minimalParams(overrides: Partial<ModelParams> = {}): ModelParams {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides
  };
}

function sseLines(chunks: Array<Record<string, unknown>>): string {
  const parts = chunks.map((c) => `data: ${JSON.stringify(c)}`);
  return `${parts.join('\n')}\n\ndata: [DONE]\n`;
}

describe('OpenAIAdapter chat_template_kwargs.enable_thinking', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('omits chat_template_kwargs when thinking is unset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'x', role: 'assistant' }, finish_reason: 'stop' }]
        })
      })
    );
    await new OpenAIAdapter({ apiKey: 'sk' }).complete(minimalParams());
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.chat_template_kwargs).toBeUndefined();
  });

  it('sends enable_thinking true when thinking: true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'x', role: 'assistant' }, finish_reason: 'stop' }]
        })
      })
    );
    await new OpenAIAdapter({ apiKey: 'sk', thinking: true }).complete(minimalParams());
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
  });

  it('sends enable_thinking false when thinking: false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'x', role: 'assistant' }, finish_reason: 'stop' }]
        })
      })
    );
    await new OpenAIAdapter({ apiKey: 'sk', thinking: false }).complete(minimalParams());
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('createModel(openai, thinking:true) forwards to adapter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'x', role: 'assistant' }, finish_reason: 'stop' }]
        })
      })
    );
    await createModel({ provider: 'openai', apiKey: 'sk', thinking: true }).complete(minimalParams());
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string).chat_template_kwargs).toEqual({ enable_thinking: true });
  });
});

describe('OpenAIAdapter complete reasoning field', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fills result.thinking from message.reasoning', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { content: 'out', reasoning: 'inner', role: 'assistant' },
              finish_reason: 'stop'
            }
          ]
        })
      })
    );
    const r = await new OpenAIAdapter({ apiKey: 'sk' }).complete(minimalParams());
    expect(r.content).toBe('out');
    expect(r.thinking).toBe('inner');
  });

  it('prefers reasoning over reasoning_content when both present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '',
                reasoning: 'primary',
                reasoning_content: 'legacy',
                role: 'assistant'
              },
              finish_reason: 'stop'
            }
          ]
        })
      })
    );
    const r = await new OpenAIAdapter({ apiKey: 'sk' }).complete(minimalParams());
    expect(r.thinking).toBe('primary');
  });

  it('fills result.thinking from message.reasoning_content when reasoning absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { content: 'z', reasoning_content: 'legacy only', role: 'assistant' },
              finish_reason: 'stop'
            }
          ]
        })
      })
    );
    const r = await new OpenAIAdapter({ apiKey: 'sk' }).complete(minimalParams());
    expect(r.thinking).toBe('legacy only');
  });
});

describe('OpenAIAdapter stream reasoning', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('yields reasoning then thinking_block_end then text', async () => {
    const encoder = new TextEncoder();
    const payload = sseLines([
      {
        choices: [{ index: 0, delta: { reasoning: 'r1' }, finish_reason: null }]
      },
      {
        choices: [{ index: 0, delta: { content: 'txt' }, finish_reason: null }]
      }
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

    const parts: Array<{ type: string; content?: unknown }> = [];
    for await (const c of new OpenAIAdapter({ apiKey: 'sk' }).stream(minimalParams())) {
      if (c.type === 'thinking' || c.type === 'text') {
        parts.push({ type: c.type, content: (c as { content?: string }).content });
      } else if (c.type === 'thinking_block_end' || c.type === 'done') {
        parts.push({ type: c.type });
      }
    }

    expect(parts).toEqual([
      { type: 'thinking', content: 'r1' },
      { type: 'thinking_block_end' },
      { type: 'text', content: 'txt' },
      { type: 'done' }
    ]);
  });

  it('accepts reasoning_content delta like legacy gateways', async () => {
    const encoder = new TextEncoder();
    const payload = sseLines([
      {
        choices: [{ index: 0, delta: { reasoning_content: 'old' }, finish_reason: null }]
      },
      {
        choices: [{ index: 0, delta: { content: 'x' }, finish_reason: null }]
      }
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

    const types: string[] = [];
    for await (const c of new OpenAIAdapter({ apiKey: 'sk' }).stream(minimalParams())) {
      types.push(c.type);
    }

    expect(types.indexOf('thinking')).toBeLessThan(types.indexOf('thinking_block_end'));
    expect(types.indexOf('thinking_block_end')).toBeLessThan(types.indexOf('text'));
  });

  it('emits trailing thinking_block_end if stream ends mid-reasoning', async () => {
    const encoder = new TextEncoder();
    const payload = sseLines([
      {
        choices: [{ index: 0, delta: { reasoning: 'only' }, finish_reason: 'stop' }]
      }
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

    const types: string[] = [];
    for await (const c of new OpenAIAdapter({ apiKey: 'sk' }).stream(minimalParams())) {
      types.push(c.type);
    }

    expect(types).toEqual(['thinking', 'thinking_block_end', 'done']);
  });
});