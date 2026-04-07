import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicAdapter } from '../../src/models/anthropic.js';
import type { ModelParams } from '../../src/core/types.js';

function minimalUserParams(overrides: Partial<ModelParams> = {}): ModelParams {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides
  };
}

describe('AnthropicAdapter request metadata', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('omits body.metadata when no sessionId and no metadata', async () => {
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
    expect(body.metadata).toBeUndefined();
  });

  it('sets metadata.user_id from sessionId', async () => {
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
    await adapter.complete(minimalUserParams({ sessionId: 'sess-abc' }));

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.metadata).toEqual({ user_id: 'sess-abc' });
  });

  it('merges dict metadata and lets it override user_id', async () => {
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
      metadata: { user_id: 'custom', foo: 1 }
    });
    await adapter.complete(minimalUserParams({ sessionId: 'sess-1' }));

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.metadata).toEqual({ user_id: 'custom', foo: 1 });
  });

  it('resolves metadata function with full ModelParams', async () => {
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
    let received: ModelParams | undefined;
    const adapter = new AnthropicAdapter({
      apiKey: 'sk-test',
      metadata: p => {
        received = p;
        return { fromFn: true };
      }
    });
    await adapter.complete(minimalUserParams({ sessionId: 'sid-fn' }));

    expect(received?.sessionId).toBe('sid-fn');
    expect(received?.messages).toHaveLength(1);

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.metadata).toEqual({ user_id: 'sid-fn', fromFn: true });
  });

  it('ignores empty metadata object when no sessionId', async () => {
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
    const adapter = new AnthropicAdapter({ apiKey: 'sk-test', metadata: {} });
    await adapter.complete(minimalUserParams());

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.metadata).toBeUndefined();
  });

  it('ignores function returning invalid shape', async () => {
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
      metadata: () => [] as unknown as Record<string, unknown>
    });
    await adapter.complete(minimalUserParams({ sessionId: 'only-session' }));

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.metadata).toEqual({ user_id: 'only-session' });
  });
});
