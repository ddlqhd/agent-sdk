import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  OpenAIAdapter,
  splitOpenAIMessageContent,
  reasoningTextFromDetails
} from '../../src/models/openai.js';
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

  it('yields thinking from reasoning_details delta when reasoning absent', async () => {
    const encoder = new TextEncoder();
    const payload = sseLines([
      {
        choices: [{
          index: 0,
          delta: {
            reasoning_details: [{ type: 'reasoning.text', text: 'detail-r' }]
          },
          finish_reason: null
        }]
      },
      {
        choices: [{ index: 0, delta: { content: 'out' }, finish_reason: null }]
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
      { type: 'thinking', content: 'detail-r' },
      { type: 'thinking_block_end' },
      { type: 'text', content: 'out' },
      { type: 'done' }
    ]);
  });
});

describe('splitOpenAIMessageContent', () => {
  it('passes through plain string content', () => {
    expect(splitOpenAIMessageContent('hello')).toEqual({ content: 'hello' });
  });

  it('maps thinking + text to reasoning and string content', () => {
    expect(
      splitOpenAIMessageContent([
        { type: 'thinking', thinking: 'inner trace' },
        { type: 'text', text: 'visible reply' }
      ])
    ).toEqual({
      content: 'visible reply',
      reasoning: 'inner trace',
      reasoningDetails: [{ type: 'reasoning.text', text: 'inner trace' }]
    });
  });

  it('includes signature in reasoning_details when present', () => {
    expect(
      splitOpenAIMessageContent([
        { type: 'thinking', thinking: 'trace', signature: 'sig-abc' },
        { type: 'text', text: 'hi' }
      ])
    ).toEqual({
      content: 'hi',
      reasoning: 'trace',
      reasoningDetails: [{ type: 'reasoning.text', text: 'trace', signature: 'sig-abc' }]
    });
  });

  it('joins multiple thinking and text parts', () => {
    expect(
      splitOpenAIMessageContent([
        { type: 'thinking', thinking: 'a' },
        { type: 'thinking', thinking: 'b' },
        { type: 'text', text: 'x' },
        { type: 'text', text: 'y' }
      ])
    ).toEqual({
      content: 'x\n\ny',
      reasoning: 'a\n\nb',
      reasoningDetails: [{ type: 'reasoning.text', text: 'a\n\nb' }]
    });
  });

  it('flattens text-only ContentPart[] without reasoning', () => {
    expect(
      splitOpenAIMessageContent([
        { type: 'text', text: 'only' }
      ])
    ).toEqual({ content: 'only' });
  });
});

describe('reasoningTextFromDetails', () => {
  it('extracts reasoning.text entries', () => {
    expect(
      reasoningTextFromDetails([
        { type: 'reasoning.text', text: 'one' },
        { type: 'reasoning.summary', summary: 'skip' },
        { type: 'reasoning.text', text: 'two' }
      ])
    ).toBe('one\n\ntwo');
  });
});

describe('OpenAIAdapter transformMessages reasoning replay', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('serializes assistant history with reasoning for complete()', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok', role: 'assistant' }, finish_reason: 'stop' }]
        })
      })
    );

    await new OpenAIAdapter({ apiKey: 'sk' }).complete(
      minimalParams({
        messages: [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'plan steps' },
              { type: 'text', text: 'answer' }
            ]
          },
          { role: 'user', content: 'follow-up' }
        ]
      })
    );

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as { messages: Array<Record<string, unknown>> };
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: 'answer',
      reasoning: 'plan steps',
      reasoning_details: [{ type: 'reasoning.text', text: 'plan steps' }]
    });
  });

  it('preserves tool_calls and empty content when only thinking + tools', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '', role: 'assistant' }, finish_reason: 'stop' }]
        })
      })
    );

    await new OpenAIAdapter({ apiKey: 'sk' }).complete(
      minimalParams({
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'pick tool' }],
            toolCalls: [{
              id: 'tc1',
              name: 'Read',
              arguments: { file_path: '/a.ts' }
            }]
          }
        ]
      })
    );

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as { messages: Array<Record<string, unknown>> };
    expect(body.messages[0]).toEqual({
      role: 'assistant',
      content: '',
      reasoning: 'pick tool',
      reasoning_details: [{ type: 'reasoning.text', text: 'pick tool' }],
      tool_calls: [{
        id: 'tc1',
        type: 'function',
        function: {
          name: 'Read',
          arguments: JSON.stringify({ file_path: '/a.ts' })
        }
      }]
    });
  });

  it('leaves plain string assistant messages without reasoning fields', async () => {
    const adapter = new OpenAIAdapter({ apiKey: 'sk' });
    const transform = adapter as unknown as {
      transformMessages(m: ModelParams['messages']): unknown[];
    };
    expect(
      transform.transformMessages([
        { role: 'assistant', content: 'plain' }
      ])
    ).toEqual([{ role: 'assistant', content: 'plain' }]);
  });
});

describe('OpenAIAdapter complete reasoning_details fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fills result.thinking from message.reasoning_details when reasoning absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'out',
                role: 'assistant',
                reasoning_details: [{ type: 'reasoning.text', text: 'from details' }]
              },
              finish_reason: 'stop'
            }
          ]
        })
      })
    );
    const r = await new OpenAIAdapter({ apiKey: 'sk' }).complete(minimalParams());
    expect(r.thinking).toBe('from details');
  });

  it('prefers reasoning over reasoning_details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '',
                role: 'assistant',
                reasoning: 'primary',
                reasoning_details: [{ type: 'reasoning.text', text: 'secondary' }]
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
});