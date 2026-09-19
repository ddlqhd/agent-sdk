import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLocalEnvironment } from '@ddlqhd/agent-sdk-exec';
import {
  assertHttpUrl,
  assertUrlSafeForFetch,
  fetchUrlToReadableContent,
  htmlToMarkdown,
  isBlockedHostname,
  isDangerousIp,
  type DnsLookupFn
} from '../../packages/agent-sdk/src/tools/builtin/web-fetch.js';

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

  it('caps the response stream without buffering the whole body', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(8 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.length;
        controller.enqueue(chunk);
        if (pulled >= 1024 * 1024) {
          controller.close();
        }
      }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response(stream, { status: 200 }))
    );
    const http = createLocalEnvironment({ dnsLookup: publicLookup }).http;
    const result = await http.request({ url: 'http://example.com/big', maxBytes: 16_384 });
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.body, 'utf8')).toBe(16_384);
    expect(pulled).toBeLessThan(64 * 1024);
  });

  it('converts HTML only when asReadable is set', async () => {
    const html =
      '<html><body><article><h1>Title</h1><p>Body text.</p></article></body></html>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async () =>
          new Response(html, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' }
          })
      )
    );
    const http = createLocalEnvironment({ dnsLookup: publicLookup }).http;
    const raw = await http.request({ url: 'http://example.com/page' });
    const readable = await http.request({ url: 'http://example.com/page', asReadable: true });
    expect(raw.body).toContain('<html>');
    expect(readable.body).not.toContain('<html>');
    expect(readable.body).toMatch(/Body text/);
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
