import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { AnthropicAdapter } from '../../src/models/anthropic.js';
import type { ModelParams } from '../../src/core/types.js';

function minimalUserParams(overrides: Partial<ModelParams> = {}): ModelParams {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides
  };
}

function okJsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => data
  };
}

function errResponse(status: number, headers?: Headers) {
  return {
    ok: false,
    status,
    headers: headers ?? new Headers(),
    arrayBuffer: async () => new ArrayBuffer(0)
  };
}

describe('AnthropicAdapter fetch retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries when fetch rejects with TypeError then succeeds', async () => {
    const done = okJsonResponse({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 }
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(done)
    );

    const adapter = new AnthropicAdapter({
      apiKey: 'sk-test',
      fetchRetry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 5000 }
    });

    const p = adapter.complete(minimalUserParams());
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.content).toBe('ok');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it('does not retry on AbortError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))
    );

    const adapter = new AnthropicAdapter({
      apiKey: 'sk-test',
      fetchRetry: { maxAttempts: 4, baseDelayMs: 10, maxDelayMs: 100 }
    });

    await expect(adapter.complete(minimalUserParams())).rejects.toMatchObject({
      name: 'AbortError'
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 then returns successful response', async () => {
    const ok = okJsonResponse({
      content: [{ type: 'text', text: 'recovered' }],
      usage: { input_tokens: 1, output_tokens: 1 }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(errResponse(503)).mockResolvedValueOnce(ok)
    );

    const adapter = new AnthropicAdapter({
      apiKey: 'sk-test',
      fetchRetry: { maxAttempts: 3, baseDelayMs: 50, maxDelayMs: 2000 }
    });

    const p = adapter.complete(minimalUserParams());
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.content).toBe('recovered');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'bad request'
      })
    );

    const adapter = new AnthropicAdapter({
      apiKey: 'sk-test',
      fetchRetry: { maxAttempts: 3 }
    });

    const p = adapter.complete(minimalUserParams());
    const rejected = expect(p).rejects.toThrow(/Anthropic API error: 400/);
    await vi.runAllTimersAsync();
    await rejected;
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
