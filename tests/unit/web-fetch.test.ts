import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  assertHttpUrl,
  assertUrlSafeForFetch,
  fetchUrlToReadableContent,
  htmlToMarkdown,
  isBlockedHostname,
  isDangerousIp,
  type DnsLookupFn
} from '../../src/tools/builtin/web-fetch.js';

const publicLookup: DnsLookupFn = async () => [{ address: '93.184.216.34', family: 4 }];

const loopbackLookup: DnsLookupFn = async () => [{ address: '127.0.0.1', family: 4 }];

describe('web-fetch SSRF helpers', () => {
  it('isDangerousIp blocks loopback and private', () => {
    expect(isDangerousIp('127.0.0.1')).toBe(true);
    expect(isDangerousIp('10.0.0.1')).toBe(true);
    expect(isDangerousIp('::1')).toBe(true);
    expect(isDangerousIp('8.8.8.8')).toBe(false);
  });

  it('isBlockedHostname blocks localhost-style hosts', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('foo.local')).toBe(true);
    expect(isBlockedHostname('metadata.google.internal')).toBe(true);
    expect(isBlockedHostname('example.com')).toBe(false);
  });

  it('assertHttpUrl rejects non-http(s)', () => {
    expect(() => assertHttpUrl(new URL('file:///etc/passwd'))).toThrow(/Only http/);
  });

  it('assertUrlSafeForFetch accepts public DNS results', async () => {
    await expect(
      assertUrlSafeForFetch(new URL('http://example.com/path'), publicLookup)
    ).resolves.toBeUndefined();
  });

  it('assertUrlSafeForFetch rejects loopback DNS results', async () => {
    await expect(
      assertUrlSafeForFetch(new URL('http://example.com/'), loopbackLookup)
    ).rejects.toThrow(/not a public endpoint/);
  });

  it('assertUrlSafeForFetch rejects literal loopback IP', async () => {
    await expect(assertUrlSafeForFetch(new URL('http://127.0.0.1/'))).rejects.toThrow();
  });
});

describe('htmlToMarkdown', () => {
  it('converts simple article HTML to markdown', () => {
    const html = `<!DOCTYPE html><html><head><title>Test</title></head><body>
      <article><h1>Hello</h1><p>World paragraph.</p></article>
    </body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toMatch(/Hello/);
    expect(md).toMatch(/World paragraph/);
  });
});

describe('fetchUrlToReadableContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches HTML and returns markdown when DNS is public', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          '<html><body><article><h1>Title</h1><p>Body text.</p></article></body></html>',
          {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' }
          }
        )
      )
    );

    const result = await fetchUrlToReadableContent('http://example.com/page', {
      dnsLookup: publicLookup,
      timeoutMs: 5000
    });

    expect(result.isError).toBe(false);
    expect(result.content).toMatch(/Body text/);
    expect(fetch).toHaveBeenCalled();
  });

  it('formats JSON responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"a":1}', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    );

    const result = await fetchUrlToReadableContent('http://example.com/api', {
      dnsLookup: publicLookup
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('"a"');
    expect(result.content).toContain('1');
  });

  it('returns error when DNS resolves to private IP', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const result = await fetchUrlToReadableContent('http://example.com/', {
      dnsLookup: loopbackLookup
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/not a public endpoint|Error fetching/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
