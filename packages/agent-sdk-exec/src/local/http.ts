import * as dns from 'node:dns';
import type { DnsLookupFn, HttpRequest, HttpResponse, HttpRuntime } from '../environment.js';
import { assertUrlSafeForFetch } from './ssrf.js';

export const HTTP_DEFAULT_TIMEOUT_MS = 30_000;
export const HTTP_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const HTTP_MAX_REDIRECTS = 5;
const USER_AGENT = 'Agent-SDK-WebFetch/0.1 (+https://github.com/)';

function primaryMimeType(contentType: string | null): string {
  if (!contentType) {
    return '';
  }
  return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
}

async function readResponseBodyWithCap(
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

  const buf = new Uint8Array(await response.arrayBuffer());
  const truncated = buf.length >= maxBytes;
  const slice = truncated ? buf.subarray(0, maxBytes) : buf;
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(slice), truncated };
}

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export class LocalHttpRuntime implements HttpRuntime {
  constructor(private readonly dnsLookup?: DnsLookupFn) {}

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
      return {
        status,
        statusText: response.statusText,
        headers: headerRecord(response.headers),
        body: text,
        mimeType: primaryMimeType(response.headers.get('content-type')),
        truncated,
        finalUrl: currentUrl.toString()
      };
    }
  }
}
