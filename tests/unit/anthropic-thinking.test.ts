import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AnthropicAdapter,
  applyAnthropicThinking,
  createAnthropic
} from '../../src/models/anthropic.js';
import { createModel } from '../../src/models/index.js';
import type { ModelParams } from '../../src/core/types.js';

function minimalUserParams(overrides: Partial<ModelParams> = {}): ModelParams {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides
  };
}

describe('applyAnthropicThinking', () => {
  it('maps true to enabled with default budget', () => {
    const { thinking, outputConfig } = applyAnthropicThinking(true);
    expect(thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
    expect(outputConfig).toBeUndefined();
  });

  it('maps false to disabled', () => {
    const { thinking, outputConfig } = applyAnthropicThinking(false);
    expect(thinking).toEqual({ type: 'disabled' });
    expect(outputConfig).toBeUndefined();
  });

  it('passes through enabled object', () => {
    const { thinking, outputConfig } = applyAnthropicThinking({
      type: 'enabled',
      budget_tokens: 5000
    });
    expect(thinking).toEqual({ type: 'enabled', budget_tokens: 5000 });
    expect(outputConfig).toBeUndefined();
  });

  it('maps adaptive with effort to output_config', () => {
    const { thinking, outputConfig } = applyAnthropicThinking({
      type: 'adaptive',
      effort: 'medium'
    });
    expect(thinking).toEqual({ type: 'adaptive' });
    expect(outputConfig).toEqual({ effort: 'medium' });
  });

  it('adaptive without effort omits output_config', () => {
    const { thinking, outputConfig } = applyAnthropicThinking({ type: 'adaptive' });
    expect(thinking).toEqual({ type: 'adaptive' });
    expect(outputConfig).toBeUndefined();
  });
});

describe('AnthropicAdapter request thinking', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('omits thinking when not configured', async () => {
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
    const adapter = new AnthropicAdapter({ apiKey: 'sk-test' });
    await adapter.complete(minimalUserParams());

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
  });

  it('sends thinking enabled with default budget when thinking: true', async () => {
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
    const adapter = new AnthropicAdapter({ apiKey: 'sk-test', thinking: true });
    await adapter.complete(minimalUserParams());

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
    expect(body.output_config).toBeUndefined();
  });

  it('sends thinking disabled when thinking: false', async () => {
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
    const adapter = new AnthropicAdapter({ apiKey: 'sk-test', thinking: false });
    await adapter.complete(minimalUserParams());

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('sends adaptive thinking and output_config.effort', async () => {
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
    const adapter = new AnthropicAdapter({
      apiKey: 'sk-test',
      thinking: { type: 'adaptive', effort: 'high' }
    });
    await adapter.complete(minimalUserParams());

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'high' });
  });

  it('createModel passes thinking to AnthropicAdapter', async () => {
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
    const adapter = createModel({
      provider: 'anthropic',
      apiKey: 'sk-test',
      thinking: { type: 'enabled', budget_tokens: 2048 }
    });
    await adapter.complete(minimalUserParams());

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });

  it('createAnthropic passes thinking', async () => {
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
    const adapter = createAnthropic({ apiKey: 'sk-test', thinking: true });
    await adapter.complete(minimalUserParams());

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
  });

  it('complete aggregates thinking blocks into result.thinking', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [
            { type: 'thinking', thinking: 'step a' },
            { type: 'text', text: 'answer' }
          ],
          usage: { input_tokens: 1, output_tokens: 2 }
        })
      })
    );
    const adapter = new AnthropicAdapter({ apiKey: 'sk-test' });
    const result = await adapter.complete(minimalUserParams());
    expect(result.content).toBe('answer');
    expect(result.thinking).toBe('step a');
  });

  it('complete joins multiple thinking blocks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [
            { type: 'thinking', thinking: 'a' },
            { type: 'thinking', thinking: 'b' }
          ],
          usage: { input_tokens: 1, output_tokens: 1 }
        })
      })
    );
    const adapter = new AnthropicAdapter({ apiKey: 'sk-test' });
    const result = await adapter.complete(minimalUserParams());
    expect(result.thinking).toBe('a\n\nb');
  });
});
