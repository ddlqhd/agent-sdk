import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import {
  assertHttpUrl,
  assertUrlSafeForFetch,
  createLocalEnvironment,
  isBlockedHostname,
  isDangerousIp,
  type DnsLookupFn,
  type HttpRuntime
} from '@ddlqhd/agent-sdk-exec';

export { assertHttpUrl, assertUrlSafeForFetch, isBlockedHostname, isDangerousIp };
export type { DnsLookupFn };

/** Default request timeout (ms). */
export const WEB_FETCH_DEFAULT_TIMEOUT_MS = 30_000;

/** Max response body bytes (stream cap). */
export const WEB_FETCH_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Max characters in returned markdown/text after conversion (second line of defense). */
export const WEB_FETCH_MAX_OUTPUT_CHARS = 512_000;

/** Max HTTP redirects when using manual redirect handling. */
export const WEB_FETCH_MAX_REDIRECTS = 5;

export { assertResolvableHostSafe } from '@ddlqhd/agent-sdk-exec';

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
  /** Execution-plane HTTP (remote exec-server or injected local). */
  http?: HttpRuntime;
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

  try {
    new URL(urlString);
  } catch {
    return { content: 'Invalid URL', isError: true };
  }

  const http =
    options.http ??
    createLocalEnvironment({ dnsLookup: options.dnsLookup }).http;

  try {
    const response = await http.request({
      url: urlString,
      timeoutMs,
      maxBytes: maxResponseBytes,
      maxRedirects
    });

    if (response.status < 200 || response.status >= 300) {
      return {
        content: `Failed to fetch: ${response.status} ${response.statusText}`,
        isError: true
      };
    }

    const mime = response.mimeType || primaryMimeType(response.headers['content-type'] ?? null);
    let content: string;
    if (mime.includes('html') || mime === '' || mime === 'application/xhtml+xml') {
      content = htmlToMarkdown(response.body);
    } else if (mime.includes('json') || mime.endsWith('+json')) {
      content = formatJsonText(response.body);
    } else {
      content = response.body;
    }

    if (response.truncated) {
      content = `${content}\n\n[Response body truncated at ${maxResponseBytes} bytes]`;
    }

    content = truncateOutput(content, maxOutputChars);
    return { content, isError: false };
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
