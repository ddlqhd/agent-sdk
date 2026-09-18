import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyEnvHttpProxy,
  isEnvHttpProxyApplied,
  isSocksProxyUrl,
  parseNoProxyList,
  resetAppliedEnvHttpProxy,
  resolveProxyUrlFromEnv,
  setUndiciFetchForTests,
  shouldBypassProxy
} from '../../src/cli/utils/apply-env-proxy.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  resetAppliedEnvHttpProxy();
  setUndiciFetchForTests(undefined);
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('resolveProxyUrlFromEnv', () => {
  it('uses Claude Code precedence: https_proxy, HTTPS_PROXY, http_proxy, HTTP_PROXY', () => {
    expect(
      resolveProxyUrlFromEnv({
        https_proxy: 'http://lower-https',
        HTTPS_PROXY: 'http://upper-https',
        http_proxy: 'http://lower-http',
        HTTP_PROXY: 'http://upper-http'
      })
    ).toBe('http://lower-https');

    expect(
      resolveProxyUrlFromEnv({
        HTTPS_PROXY: 'http://upper-https',
        http_proxy: 'http://lower-http',
        HTTP_PROXY: 'http://upper-http'
      })
    ).toBe('http://upper-https');

    expect(
      resolveProxyUrlFromEnv({
        http_proxy: 'http://lower-http',
        HTTP_PROXY: 'http://upper-http'
      })
    ).toBe('http://lower-http');

    expect(resolveProxyUrlFromEnv({ HTTP_PROXY: 'http://upper-http' })).toBe('http://upper-http');
  });

  it('ignores blank values', () => {
    expect(resolveProxyUrlFromEnv({ HTTPS_PROXY: '  ', HTTP_PROXY: 'http://ok' })).toBe('http://ok');
    expect(resolveProxyUrlFromEnv({})).toBeUndefined();
  });
});

describe('isSocksProxyUrl', () => {
  it('detects socks schemes and ignores HTTP proxies', () => {
    expect(isSocksProxyUrl('socks5://127.0.0.1:1080')).toBe(true);
    expect(isSocksProxyUrl('socks://127.0.0.1:1080')).toBe(true);
    expect(isSocksProxyUrl('http://127.0.0.1:7890')).toBe(false);
  });
});

describe('parseNoProxyList / shouldBypassProxy', () => {
  it('splits on commas or whitespace', () => {
    expect(parseNoProxyList('localhost, 127.0.0.1')).toEqual(['localhost', '127.0.0.1']);
    expect(parseNoProxyList('localhost 127.0.0.1')).toEqual(['localhost', '127.0.0.1']);
  });

  it('matches *, exact hosts, and domain suffixes', () => {
    expect(shouldBypassProxy('api.openai.com', undefined)).toBe(false);
    expect(shouldBypassProxy('localhost', '*')).toBe(true);
    expect(shouldBypassProxy('localhost', 'localhost,127.0.0.1')).toBe(true);
    expect(shouldBypassProxy('api.openai.com', 'localhost,127.0.0.1')).toBe(false);
    expect(shouldBypassProxy('example.com', '.example.com')).toBe(true);
    expect(shouldBypassProxy('foo.example.com', '.example.com')).toBe(true);
    expect(shouldBypassProxy('example.com', 'example.com')).toBe(true);
    expect(shouldBypassProxy('foo.example.com', 'example.com')).toBe(true);
    expect(shouldBypassProxy('example.org', 'example.com')).toBe(false);
    expect(shouldBypassProxy('api.openai.com', 'localhost 127.0.0.1 api.openai.com')).toBe(true);
  });
});

describe('applyEnvHttpProxy', () => {
  it('does not wrap fetch when no proxy is set', () => {
    const before = globalThis.fetch;
    expect(applyEnvHttpProxy({})).toBe(false);
    expect(isEnvHttpProxyApplied()).toBe(false);
    expect(globalThis.fetch).toBe(before);
  });

  it('warns and skips SOCKS URLs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const before = globalThis.fetch;
    expect(applyEnvHttpProxy({ HTTPS_PROXY: 'socks5://127.0.0.1:1080' })).toBe(false);
    expect(isEnvHttpProxyApplied()).toBe(false);
    expect(globalThis.fetch).toBe(before);
    expect(warn.mock.calls.join(' ')).toMatch(/SOCKS/);
  });

  it('warns and does not wrap fetch for an invalid proxy URL', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const before = globalThis.fetch;
    expect(applyEnvHttpProxy({ HTTPS_PROXY: 'not-a-url' })).toBe(false);
    expect(globalThis.fetch).toBe(before);
    expect(warn.mock.calls.join(' ')).toMatch(/invalid proxy URL/);
  });

  it('wraps fetch once and stays idempotent', () => {
    expect(applyEnvHttpProxy({ HTTPS_PROXY: 'http://127.0.0.1:9' })).toBe(true);
    const wrapped = globalThis.fetch;
    expect(wrapped).not.toBe(realFetch);
    expect(applyEnvHttpProxy({ HTTPS_PROXY: 'http://127.0.0.1:8' })).toBe(true);
    expect(globalThis.fetch).toBe(wrapped);
  });

  it('passes a real ProxyAgent dispatcher to undici.fetch', async () => {
    const inits: Array<{ dispatcher?: unknown }> = [];
    setUndiciFetchForTests((_input, init) => {
      inits.push(init as { dispatcher?: unknown });
      return Promise.resolve(new Response('ok'));
    });

    expect(applyEnvHttpProxy({ HTTPS_PROXY: 'http://127.0.0.1:9' })).toBe(true);
    await globalThis.fetch('https://api.openai.com/v1/models');
    expect(inits[0]?.dispatcher).toBeDefined();
    expect(typeof (inits[0]?.dispatcher as { dispatch?: unknown }).dispatch).toBe('function');
  });

  it('bypasses the proxy for NO_PROXY hosts including Request input', async () => {
    const fallback = vi.fn().mockResolvedValue(new Response('direct'));
    const proxied = vi.fn().mockResolvedValue(new Response('proxied'));
    globalThis.fetch = fallback;
    setUndiciFetchForTests(proxied);

    expect(
      applyEnvHttpProxy({ HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: 'localhost' })
    ).toBe(true);

    await globalThis.fetch(new Request('http://localhost/health'));
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(proxied).not.toHaveBeenCalled();

    await globalThis.fetch('https://api.openai.com/v1/models');
    expect(proxied).toHaveBeenCalledTimes(1);
  });

  it('does not write npm undici onto Node dispatcher symbols', () => {
    const symbol1 = Symbol.for('undici.globalDispatcher.1');
    const beforeSymbol = (globalThis as Record<symbol, unknown>)[symbol1];
    expect(applyEnvHttpProxy({ HTTPS_PROXY: 'http://127.0.0.1:9' })).toBe(true);
    expect((globalThis as Record<symbol, unknown>)[symbol1]).toBe(beforeSymbol);
    resetAppliedEnvHttpProxy();
    expect(globalThis.fetch).toBe(realFetch);
  });
});
