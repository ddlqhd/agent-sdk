import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatTavilyResultsMarkdown,
  tavilyWebSearch,
  TAVILY_SEARCH_URL
} from '../../src/tools/builtin/tavily-search.js';
import { webSearchTool } from '../../src/tools/builtin/web.js';

describe('formatTavilyResultsMarkdown', () => {
  it('should format results with markdown links', () => {
    const md = formatTavilyResultsMarkdown({
      results: [
        { title: 'Example', url: 'https://example.com', content: 'Snippet text.' }
      ]
    });
    expect(md).toContain('[Example](https://example.com)');
    expect(md).toContain('Snippet text.');
  });

  it('should include answer when present', () => {
    const md = formatTavilyResultsMarkdown({
      answer: 'Short answer.',
      results: [{ title: 'A', url: 'https://a.test', content: 'x' }]
    });
    expect(md).toContain('**Summary**');
    expect(md).toContain('Short answer.');
  });

  it('should escape brackets in titles for safe markdown links', () => {
    const md = formatTavilyResultsMarkdown({
      results: [{ title: 'See [foo] bar', url: 'https://x.test', content: 'c' }]
    });
    expect(md).toContain('\\[foo\\]');
    expect(md).toContain('https://x.test');
  });
});

describe('tavilyWebSearch', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          new Response(JSON.stringify({ query: 'q', results: [] }), { status: 200 })
        )
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it('should return markdown on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              title: 'Doc',
              url: 'https://doc.example/page',
              content: 'Body'
            }
          ]
        }),
        { status: 200 }
      )
    );

    const result = await tavilyWebSearch({
      query: 'test query',
      apiKey: 'tvly-test-key'
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('[Doc](https://doc.example/page)');
    expect(result.content).toContain('Body');
    expect(fetch).toHaveBeenCalledWith(
      TAVILY_SEARCH_URL,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(call[1]!.body as string) as Record<string, unknown>;
    expect(body.api_key).toBe('tvly-test-key');
    expect(body.query).toBe('test query');
    expect(body.search_depth).toBe('basic');
  });

  it('should map domain filters and truncate', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), { status: 200 })
    );

    const allowed = Array.from({ length: 5 }, (_, i) => `a${i}.com`);
    const blocked = ['bad.com'];

    await tavilyWebSearch({
      query: 'q',
      apiKey: 'k',
      allowed_domains: allowed,
      blocked_domains: blocked
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string) as {
      include_domains: string[];
      exclude_domains: string[];
    };
    expect(body.include_domains).toEqual(allowed);
    expect(body.exclude_domains).toEqual(blocked);
  });

  it('should return isError on 401', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: { error: 'Unauthorized' } }), { status: 401 })
    );

    const result = await tavilyWebSearch({ query: 'q', apiKey: 'bad' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Tavily search error');
    expect(result.content).toContain('Unauthorized');
  });

  it('should return isError on network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));

    const result = await tavilyWebSearch({ query: 'q', apiKey: 'k' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('network down');
  });
});

describe('webSearchTool without TAVILY_API_KEY', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return stub when key is missing', async () => {
    delete process.env.TAVILY_API_KEY;
    const handler = webSearchTool.handler;
    const result = await handler!({ query: 'hello world' }, undefined);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('TAVILY_API_KEY');
    expect(result.content).toContain('hello world');
  });
});
