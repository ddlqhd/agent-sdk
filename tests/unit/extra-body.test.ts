import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIAdapter } from '../../src/models/openai.js';
import { AnthropicAdapter } from '../../src/models/anthropic.js';
import { OllamaAdapter } from '../../src/models/ollama.js';
import { createModel } from '../../src/models/index.js';
import type { ModelParams } from '../../src/core/types.js';

function minimalParams(overrides: Partial<ModelParams> = {}): ModelParams {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides
  };
}

describe('adapter extraBody shallow merge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('OpenAIAdapter merges custom top-level fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'x', role: 'assistant' }, finish_reason: 'stop' }]
        })
      })
    );
    await new OpenAIAdapter({
      apiKey: 'sk',
      extraBody: { custom_field: 'z' }
    }).complete(minimalParams());
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.custom_field).toBe('z');
  });

  it('OpenAIAdapter extraBody can override max_tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'x', role: 'assistant' }, finish_reason: 'stop' }]
        })
      })
    );
    await new OpenAIAdapter({
      apiKey: 'sk',
      extraBody: { max_tokens: 7 }
    }).complete(minimalParams());
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(7);
  });

  it('AnthropicAdapter extraBody overrides previous keys', async () => {
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
    await new AnthropicAdapter({
      apiKey: 'sk',
      thinking: true,
      extraBody: { max_tokens: 9 }
    }).complete(minimalParams());
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
    expect(body.max_tokens).toBe(9);
  });

  it('OllamaAdapter merges extraBody', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: { content: 'x' } })
      })
    );
    await new OllamaAdapter({
      extraBody: { seed: 42 }
    }).complete(minimalParams());
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.seed).toBe(42);
  });

  it('createModel forwards extraBody to OpenAI adapter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'x', role: 'assistant' }, finish_reason: 'stop' }]
        })
      })
    );
    await createModel({
      provider: 'openai',
      apiKey: 'sk',
      extraBody: { routed: true }
    }).complete(minimalParams());
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.routed).toBe(true);
  });
});
