import * as dns from 'node:dns';
import type { DnsLookupFn, FileSystem, HttpRequest, HttpResponse, HttpRuntime } from '../environment.js';
import { shouldReplaceWithSpill, SPILL_MAX_DIRECT_CHARS } from './spill.js';
import { assertUrlSafeForFetch } from './ssrf.js';
import { primaryMimeType, toReadableContent, WEB_FETCH_MAX_OUTPUT_CHARS } from './web-readable.js';

export const HTTP_DEFAULT_TIMEOUT_MS = 30_000;
export const HTTP_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const HTTP_MAX_REDIRECTS = 5;
const USER_AGENT = 'Agent-SDK-WebFetch/0.1 (+https://github.com/)';

function mergeChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function decodeUtf8(buf: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

/**
 * Read a response body up to `maxBytes`, cancelling the stream as soon as the cap is hit.
 */
export async function readResponseBodyWithCap(
  response: Response,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const cl = response.headers.get('content-length');
  if (cl !== null && cl !== '') {
    const n = Number.parseInt(cl, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new Error(`Response too large (Content-Length: ${n} bytes, max ${maxBytes})`);
    }
  }

  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.length <= maxBytes) {
      return { text: decodeUtf8(buf), truncated: false };
    }
    return { text: decodeUtf8(buf.subarray(0, maxBytes)), truncated: true };
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
        continue;
      }
      const rest = maxBytes - total;
      if (rest > 0) {
        chunks.push(value.subarray(0, rest));
        total += rest;
      }
      truncated = true;
      await reader.cancel();
      break;
    }
  } finally {
    reader.releaseLock();
  }

  return { text: decodeUtf8(mergeChunks(chunks, total)), truncated };
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // ignore
  }
}

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export class LocalHttpRuntime implements HttpRuntime {
  constructor(
    private readonly dnsLookup?: DnsLookupFn,
    private readonly fs?: FileSystem
  ) {}

  async request(req: HttpRequest): Promise<HttpResponse> {
    const timeoutMs = req.timeoutMs ?? HTTP_DEFAULT_TIMEOUT_MS;
    const maxBytes = req.maxBytes ?? HTTP_MAX_RESPONSE_BYTES;
    const maxRedirects = req.maxRedirects ?? HTTP_MAX_REDIRECTS;
    const lookup = this.dnsLookup ?? (dns.promises.lookup as DnsLookupFn);

    let currentUrl = new URL(req.url);
    let redirectCount = 0;

    for (;;) {
      await assertUrlSafeForFetch(currentUrl, lookup);
      const response = await fetch(currentUrl, {
        method: req.method ?? 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8',
          'User-Agent': USER_AGENT,
          ...req.headers
        }
      });

      const status = response.status;
      if (status >= 300 && status < 400) {
        await cancelResponseBody(response);
        const loc = response.headers.get('location');
        if (!loc || redirectCount >= maxRedirects) {
          throw new Error(
            loc
              ? `Too many redirects or missing Location (HTTP ${status})`
              : `Redirect without Location (HTTP ${status})`
          );
        }
        redirectCount++;
        currentUrl = new URL(loc, currentUrl);
        continue;
      }

      const { text, truncated } = await readResponseBodyWithCap(response, maxBytes);
      const mimeType = primaryMimeType(response.headers.get('content-type'));
      let body = text;
      let storagePath: string | undefined;
      if (req.asReadable === true) {
        body = toReadableContent(text, mimeType, req.maxOutputChars ?? WEB_FETCH_MAX_OUTPUT_CHARS);
        if (truncated) {
          body = `${body}\n\n[Response body truncated at ${maxBytes} bytes]`;
        }
        if (this.fs && body.length > SPILL_MAX_DIRECT_CHARS) {
          const spilled = await this.fs.spillText(body, { toolName: 'WebFetch' });
          if (shouldReplaceWithSpill(spilled, body)) {
            body = spilled.content;
            storagePath = spilled.storagePath;
          }
        }
      }
      return {
        status,
        statusText: response.statusText,
        headers: headerRecord(response.headers),
        body,
        mimeType,
        truncated,
        finalUrl: currentUrl.toString(),
        storagePath
      };
    }
  }
}
