import chalk from 'chalk';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { Dispatcher } from 'undici';

const PROXY_URL_KEYS = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY'] as const;
const SOCKS_PROXY_RE = /^(socks4a?|socks5h?|socks):\/\//i;

type ProcessEnvLike = Record<string, string | undefined>;
type UndiciFetch = typeof undiciFetch;

let fetchImpl: UndiciFetch = undiciFetch;

/** @internal Swap undici.fetch in unit tests so assertions hit the production wrap path. */
export function setUndiciFetchForTests(
  fn: ((input: unknown, init?: unknown) => Promise<Response>) | undefined
): void {
  fetchImpl = (fn ?? undiciFetch) as UndiciFetch;
}

let applied = false;
let previousFetch: typeof globalThis.fetch | undefined;
let installedProxy: ProxyAgent | undefined;

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

function warnProxy(message: string): void {
  console.warn(chalk.yellow(`CLI proxy: ${message}`));
}

function redactProxyUrl(uri: string): string {
  try {
    const parsed = new URL(uri);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return uri;
  }
}

function isHttpOrHttpsProxyUrl(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveFetchUrl(input: unknown): URL | undefined {
  if (typeof input === 'string') {
    try {
      return new URL(input);
    } catch {
      return undefined;
    }
  }
  if (input instanceof URL) {
    return input;
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try {
      return new URL(input.url);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Claude Code order: `https_proxy`, `HTTPS_PROXY`, `http_proxy`, `HTTP_PROXY`.
 */
export function resolveProxyUrlFromEnv(env: ProcessEnvLike = process.env): string | undefined {
  return firstNonEmpty(...PROXY_URL_KEYS.map((key) => env[key]));
}

export function isSocksProxyUrl(uri: string): boolean {
  return SOCKS_PROXY_RE.test(uri);
}

/**
 * Split `NO_PROXY` / `no_proxy` on commas or whitespace. `*` bypasses every host.
 */
export function parseNoProxyList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Whether `hostname` should skip the proxy per a `NO_PROXY` list.
 * A leading-dot pattern and a bare domain both match the host and its subdomains.
 */
export function shouldBypassProxy(hostname: string, noProxy: string | undefined): boolean {
  const entries = parseNoProxyList(noProxy);
  if (entries.length === 0) return false;

  const host = normalizeHost(hostname);
  if (!host) return false;

  for (const entry of entries) {
    if (entry === '*') return true;
    const patternHost = normalizeHost(entry).replace(/^\./, '').split(':')[0];
    if (!patternHost) continue;
    if (host === patternHost || host.endsWith(`.${patternHost}`)) {
      return true;
    }
  }
  return false;
}

function createProxiedFetch(
  proxy: Dispatcher,
  noProxy: string,
  fallback: typeof globalThis.fetch
): typeof globalThis.fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = resolveFetchUrl(input);
    if (url && shouldBypassProxy(url.hostname, noProxy)) {
      return fallback(input, init);
    }
    return fetchImpl(input as Parameters<UndiciFetch>[0], {
      ...(init ?? {}),
      dispatcher: proxy
    } as Parameters<UndiciFetch>[1]);
  }) as typeof globalThis.fetch;
}

/**
 * Route CLI `fetch` through npm `undici` + a real {@link ProxyAgent}.
 *
 * Do **not** call `setGlobalDispatcher`: npm undici mirrors it onto Node's
 * well-known symbols, and Node 24/26 fetch then dies with `TypeError: fetch failed`.
 *
 * `NO_PROXY` is applied in the wrap (undici 6 `ProxyAgent` has no no_proxy option).
 * Idempotent. Never throws.
 *
 * @returns `true` when a dispatcher is already installed or was just installed
 */
export function applyEnvHttpProxy(env: ProcessEnvLike = process.env): boolean {
  if (applied) {
    return true;
  }

  const uri = resolveProxyUrlFromEnv(env);
  if (!uri) {
    return false;
  }
  if (isSocksProxyUrl(uri)) {
    warnProxy(`SOCKS proxies are not supported, ignoring ${redactProxyUrl(uri)}`);
    return false;
  }
  if (!isHttpOrHttpsProxyUrl(uri)) {
    warnProxy(`invalid proxy URL, ignoring ${redactProxyUrl(uri)}`);
    return false;
  }

  try {
    const proxy = new ProxyAgent(uri);
    const fallback = globalThis.fetch;
    previousFetch = fallback;
    installedProxy = proxy;
    globalThis.fetch = createProxiedFetch(
      proxy,
      firstNonEmpty(env.no_proxy, env.NO_PROXY) ?? '',
      fallback
    );
  } catch (error) {
    previousFetch = undefined;
    installedProxy = undefined;
    const detail = error instanceof Error ? error.message : String(error);
    warnProxy(`failed to apply ${redactProxyUrl(uri)}: ${detail}`);
    return false;
  }

  applied = true;
  return true;
}

/** @internal Whether {@link applyEnvHttpProxy} has installed a dispatcher in this process. */
export function isEnvHttpProxyApplied(): boolean {
  return applied;
}

/** @internal Restore `globalThis.fetch` after tests that call {@link applyEnvHttpProxy}. */
export function resetAppliedEnvHttpProxy(): void {
  if (previousFetch) {
    globalThis.fetch = previousFetch;
  }
  const proxy = installedProxy;
  installedProxy = undefined;
  applied = false;
  previousFetch = undefined;
  if (proxy) {
    void proxy.close().catch(() => undefined);
  }
}
