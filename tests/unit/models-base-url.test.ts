import { describe, it, expect, vi, afterEach } from 'vitest';
import { ensureApiVersionSuffix, joinApiUrl, normalizeApiBaseUrl } from '../../src/models/base.js';
import { AnthropicAdapter } from '../../src/models/anthropic.js';
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

describe('ensureApiVersionSuffix', () => {
  it('appends /v1 when missing', () => {
    expect(ensureApiVersionSuffix('https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1'
    );
  });

  it('is idempotent when /v1 already present', () => {
    expect(ensureApiVersionSuffix('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1'
    );
  });

  it('strips trailing slash before appending /v1', () => {
    expect(ensureApiVersionSuffix('https://api.anthropic.com/')).toBe(
      'https://api.anthropic.com/v1'
    );
  });

  it('leaves gateway base URLs that already end with /v1 unchanged', () => {
    expect(ensureApiVersionSuffix('https://gateway.example/api/v1')).toBe(
      'https://gateway.example/api/v1'
    );
  });

  it('leaves /v2 base URLs unchanged', () => {
    expect(ensureApiVersionSuffix('https://api.anthropic.com/v2')).toBe(
      'https://api.anthropic.com/v2'
    );
  });

  it('leaves gateway /api/v2 base URLs unchanged', () => {
    expect(ensureApiVersionSuffix('https://gateway.example/api/v2')).toBe(
      'https://gateway.example/api/v2'
    );
  });

  it('leaves /v10 base URLs unchanged without appending /v1', () => {
    expect(ensureApiVersionSuffix('https://api.example.com/v10')).toBe(
      'https://api.example.com/v10'
    );
  });
});

describe('OpenAIAdapter base URL', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests /v1/chat/completions with default baseUrl', async () => {
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
    await new OpenAIAdapter({ apiKey: 'sk' }).complete(params);

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('auto-appends /v1 when baseUrl omits version', async () => {
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
      baseUrl: 'https://api.openai.com'
    }).complete(params);

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
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

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('requests /v2/chat/completions when baseUrl includes /v2', async () => {
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
      baseUrl: 'https://api.openai.com/v2'
    }).complete(params);

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toBe('https://api.openai.com/v2/chat/completions');
  });
});

describe('AnthropicAdapter base URL', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests /v1/messages with default baseUrl', async () => {
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

    const params: ModelParams = { messages: [{ role: 'user', content: 'hi' }] };
    await new AnthropicAdapter({ apiKey: 'sk-ant' }).complete(params);

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('auto-appends /v1 when baseUrl omits version', async () => {
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

    const params: ModelParams = { messages: [{ role: 'user', content: 'hi' }] };
    await new AnthropicAdapter({
      apiKey: 'sk-ant',
      baseUrl: 'https://api.anthropic.com'
    }).complete(params);

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('requests /messages without double slash when baseUrl has trailing slash', async () => {
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

    const params: ModelParams = { messages: [{ role: 'user', content: 'hi' }] };
    await new AnthropicAdapter({
      apiKey: 'sk-ant',
      baseUrl: 'https://api.anthropic.com/v1/'
    }).complete(params);

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('requests /v2/messages when baseUrl includes /v2', async () => {
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

    const params: ModelParams = { messages: [{ role: 'user', content: 'hi' }] };
    await new AnthropicAdapter({
      apiKey: 'sk-ant',
      baseUrl: 'https://api.anthropic.com/v2'
    }).complete(params);

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toBe('https://api.anthropic.com/v2/messages');
  });
});
