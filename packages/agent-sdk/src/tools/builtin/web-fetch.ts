import {
  assertHttpUrl,
  assertUrlSafeForFetch,
  createLocalEnvironment,
  htmlToMarkdown,
  isBlockedHostname,
  isDangerousIp,
  WEB_FETCH_MAX_OUTPUT_CHARS,
  type DnsLookupFn,
  type HttpRuntime
} from '@ddlqhd/agent-sdk-exec';

export { assertHttpUrl, assertUrlSafeForFetch, isBlockedHostname, isDangerousIp, htmlToMarkdown };
export type { DnsLookupFn };
export { assertResolvableHostSafe } from '@ddlqhd/agent-sdk-exec';

/** Default request timeout (ms). */
export const WEB_FETCH_DEFAULT_TIMEOUT_MS = 30_000;

/** Max response body bytes (stream cap). */
export const WEB_FETCH_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Max characters in returned markdown/text after conversion (second line of defense). */
export { WEB_FETCH_MAX_OUTPUT_CHARS };

/** Max HTTP redirects when using manual redirect handling. */
export const WEB_FETCH_MAX_REDIRECTS = 5;

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
 * HTML/JSON conversion and large-output spill happen on the execution plane.
 */
export async function fetchUrlToReadableContent(
  urlString: string,
  options: WebFetchContentOptions = {}
): Promise<{ content: string; isError: boolean; storagePath?: string }> {
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
      maxRedirects,
      asReadable: true,
      maxOutputChars
    });

    if (response.status < 200 || response.status >= 300) {
      return {
        content: `Failed to fetch: ${response.status} ${response.statusText}`,
        isError: true
      };
    }

    return {
      content: response.body,
      isError: false,
      storagePath: response.storagePath
    };
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
