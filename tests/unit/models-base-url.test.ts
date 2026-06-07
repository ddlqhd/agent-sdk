import { describe, it, expect, vi, afterEach } from 'vitest';
import { joinApiUrl, normalizeApiBaseUrl } from '../../src/models/base.js';
import { OpenAIAdapter } from '../../src/models/openai.js';
import type { ModelParams } from '../../src/core/types.js';

describe('normalizeApiBaseUrl / joinApiUrl', () => {
  it('strips trailing slashes', () => {
    expect(normalizeApiBaseUrl('https://openrouter.ai/api/v1/')).toBe(
      'https://openrouter.ai/api/v1'
    );
  });

  it('joins base and path without double slash', () => {
    expect(joinApiUrl('https://openrouter.ai/api/v1/', '/chat/completions')).toBe(
      'https://openrouter.ai/api/v1/chat/completions'
    );
  });
});

describe('OpenAIAdapter base URL trailing slash', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests chat/completions without double slash when baseUrl has trailing slash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok', role: 'assistant' }, finish_reason: 'stop' }]
        })
      })
    );

    const params: ModelParams = { messages: [{ role: 'user', content: 'hi' }] };
    await new OpenAIAdapter({
      apiKey: 'sk',
      baseUrl: 'https://openrouter.ai/api/v1/'
    }).complete(params);

    const init = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(init).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});
