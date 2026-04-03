import * as dns from 'node:dns';
import ipaddr from 'ipaddr.js';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

/** Default request timeout (ms). */
export const WEB_FETCH_DEFAULT_TIMEOUT_MS = 30_000;

/** Max response body bytes (stream cap). */
export const WEB_FETCH_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Max characters in returned markdown/text after conversion (second line of defense). */
export const WEB_FETCH_MAX_OUTPUT_CHARS = 512_000;

/** Max HTTP redirects when using manual redirect handling. */
export const WEB_FETCH_MAX_REDIRECTS = 5;

const USER_AGENT = 'Agent-SDK-WebFetch/0.1 (+https://github.com/)';

export type DnsLookupFn = (
  hostname: string,
  options: { all: true; verbatim?: boolean }
) => Promise<import('node:dns').LookupAddress[]>;

function isBlockedAddress(addr: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  if (addr.kind() === 'ipv4') {
    return addr.range() !== 'unicast';
  }
  const v6 = addr as ipaddr.IPv6;
  if (v6.isIPv4MappedAddress()) {
    const v4 = v6.toIPv4Address();
    return v4.range() !== 'unicast';
  }
  return v6.range() !== 'unicast';
}

/** Returns true if the IP must not be reached (SSRF). Exported for tests. */
export function isDangerousIp(ip: string): boolean {
  try {
    if (!ipaddr.isValid(ip)) {
      return true;
    }
    const addr = ipaddr.parse(ip);
    return isBlockedAddress(addr);
  } catch {
    return true;
  }
}

/** Hostname patterns blocked without DNS (metadata, local, etc.). Exported for tests. */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === 'metadata') {
    return true;
  }
  if (h.endsWith('.localhost')) {
    return true;
  }
  if (h === 'metadata.google.internal') {
    return true;
  }
  if (h.endsWith('.internal')) {
    return true;
  }
  if (h.endsWith('.local')) {
    return true;
  }
  return false;
}

/**
 * Ensures URL scheme is http(s) only.
 */
export function assertHttpUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http and https URLs are allowed, got: ${url.protocol}`);
  }
}

/**
 * Resolve hostname and ensure no resolved address is in a forbidden range.
 */
export async function assertResolvableHostSafe(
  hostname: string,
  lookup: DnsLookupFn = dns.promises.lookup as DnsLookupFn
): Promise<void> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  if (!results.length) {
    throw new Error('DNS lookup returned no addresses');
  }
  for (const { address } of results) {
    if (isDangerousIp(address)) {
      throw new Error(`Refused to connect: address "${address}" is not a public endpoint`);
    }
  }
}

/**
 * Full URL check: scheme, hostname blocklist, literal IP or DNS+IP rules.
 */
export async function assertUrlSafeForFetch(
  url: URL,
  lookup: DnsLookupFn = dns.promises.lookup as DnsLookupFn
): Promise<void> {
  assertHttpUrl(url);
  const host = url.hostname;
  if (!host) {
    throw new Error('URL has no hostname');
  }
  if (isBlockedHostname(host)) {
    throw new Error(`Refused to connect: hostname "${host}" is blocked`);
  }
  if (ipaddr.isValid(host)) {
    if (isDangerousIp(host)) {
      throw new Error(`Refused to connect: address "${host}" is not a public endpoint`);
    }
    return;
  }
  await assertResolvableHostSafe(host, lookup);
}

export interface ReadBodyResult {
  text: string;
  truncated: boolean;
}

/**
 * Read response body up to maxBytes UTF-8; tracks truncation.
 */
export async function readResponseBodyWithCap(
  response: Response,
  maxBytes: number
): Promise<ReadBodyResult> {
  const cl = response.headers.get('content-length');
  if (cl !== null && cl !== '') {
    const n = Number.parseInt(cl, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new Error(`Response too large (Content-Length: ${n} bytes, max ${maxBytes})`);
    }
  }

  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    return decodeWithCap(buf, maxBytes);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.length === 0) {
        continue;
      }
      if (total + value.length <= maxBytes) {
        chunks.push(value);
        total += value.length;
      } else {
        const rest = maxBytes - total;
        if (rest > 0) {
          chunks.push(value.slice(0, rest));
          total += rest;
        }
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const merged = mergeChunks(chunks, total);
  const dec = decodeWithCap(merged, maxBytes);
  return { text: dec.text, truncated: dec.truncated || truncated };
}

function mergeChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function decodeWithCap(buf: Uint8Array, maxBytes: number): ReadBodyResult {
  const truncated = buf.length >= maxBytes;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return { text: decoder.decode(buf), truncated };
}

function primaryMimeType(contentType: string | null): string {
  if (!contentType) {
    return '';
  }
  return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * Convert HTML to markdown via Readability + Turndown. If Readability yields nothing, falls back to body HTML.
 * Stronger compatibility can use jsdom instead of linkedom (heavier).
 */
export function htmlToMarkdown(html: string): string {
  const { document } = parseHTML(html);
  const reader = new Readability(document);
  const article = reader.parse();
  let htmlContent = article?.content?.trim() ?? '';
  if (!htmlContent && document.body) {
    htmlContent = document.body.innerHTML ?? '';
  }
  if (!htmlContent) {
    return '';
  }
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });
  return turndown.turndown(htmlContent).trim();
}

function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n\n[Output truncated to ${maxChars} characters]`;
}

function formatJsonText(raw: string): string {
  try {
    const v = JSON.parse(raw) as unknown;
    return JSON.stringify(v, null, 2);
  } catch {
    return raw;
  }
}

export interface WebFetchContentOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxOutputChars?: number;
  maxRedirects?: number;
  /** Test-only DNS override */
  dnsLookup?: DnsLookupFn;
}

/**
 * Fetches a URL with SSRF checks, redirect re-validation, timeout, and size limits.
 * Returns markdown or plain text suitable for model context.
 */
export async function fetchUrlToReadableContent(
  urlString: string,
  options: WebFetchContentOptions = {}
): Promise<{ content: string; isError: boolean }> {
  const timeoutMs = options.timeoutMs ?? WEB_FETCH_DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? WEB_FETCH_MAX_RESPONSE_BYTES;
  const maxOutputChars = options.maxOutputChars ?? WEB_FETCH_MAX_OUTPUT_CHARS;
  const maxRedirects = options.maxRedirects ?? WEB_FETCH_MAX_REDIRECTS;
  const lookup = options.dnsLookup ?? (dns.promises.lookup as DnsLookupFn);

  let currentUrl: URL;
  try {
    currentUrl = new URL(urlString);
  } catch {
    return { content: 'Invalid URL', isError: true };
  }

  try {
    let redirectCount = 0;
    for (;;) {
      await assertUrlSafeForFetch(currentUrl, lookup);

      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8',
          'User-Agent': USER_AGENT
        }
      });

      const status = response.status;
      if (status >= 300 && status < 400) {
        const loc = response.headers.get('location');
        if (!loc || redirectCount >= maxRedirects) {
          return {
            content: loc
              ? `Too many redirects or missing Location (HTTP ${status})`
              : `Redirect without Location (HTTP ${status})`,
            isError: true
          };
        }
        redirectCount++;
        currentUrl = new URL(loc, currentUrl);
        continue;
      }

      if (!response.ok) {
        return {
          content: `Failed to fetch: ${status} ${response.statusText}`,
          isError: true
        };
      }

      const mime = primaryMimeType(response.headers.get('content-type'));
      const { text: rawText, truncated: bodyTruncated } = await readResponseBodyWithCap(
        response,
        maxResponseBytes
      );

      let content: string;
      if (mime.includes('html') || mime === '' || mime === 'application/xhtml+xml') {
        content = htmlToMarkdown(rawText);
      } else if (mime.includes('json') || mime.endsWith('+json')) {
        content = formatJsonText(rawText);
      } else {
        content = rawText;
      }

      if (bodyTruncated) {
        content = `${content}\n\n[Response body truncated at ${maxResponseBytes} bytes]`;
      }

      content = truncateOutput(content, maxOutputChars);
      return { content, isError: false };
    }
  } catch (error) {
    return {
      content: `Error fetching webpage: ${formatNetworkError(error)}`,
      isError: true
    };
  }
}

/** Includes undici/Node `fetch` nested causes (e.g. ECONNRESET) — `error.message` alone is often just "fetch failed". */
function formatNetworkError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const parts: string[] = [error.message];
  let cursor: unknown = error.cause;
  let depth = 0;
  while (cursor instanceof Error && depth < 4) {
    parts.push(cursor.message);
    cursor = cursor.cause;
    depth++;
  }
  if (typeof cursor === 'object' && cursor !== null && 'code' in cursor) {
    const code = (cursor as { code?: string }).code;
    if (code && !parts.join(' ').includes(code)) {
      parts.push(`code=${code}`);
    }
  }
  return parts.join(' — ');
}
