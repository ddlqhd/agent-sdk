import type { ToolResult } from '../../core/types.js';

export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

/** Aligns with WebFetch timeout scale. */
export const TAVILY_SEARCH_TIMEOUT_MS = 30_000;

/** Tavily allows up to 300 include domains per request. */
export const TAVILY_MAX_INCLUDE_DOMAINS = 300;

/** Tavily allows up to 150 exclude domains per request. */
export const TAVILY_MAX_EXCLUDE_DOMAINS = 150;

const SEARCH_DEPTHS = new Set(['basic', 'advanced', 'fast', 'ultra-fast']);

export type TavilySearchDepth = 'basic' | 'advanced' | 'fast' | 'ultra-fast';

export interface TavilyWebSearchInput {
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
  apiKey: string;
  /** From env or default */
  searchDepth?: TavilySearchDepth;
  maxResults?: number;
}

interface TavilySearchResultItem {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilySearchResponseBody {
  query?: string;
  results?: TavilySearchResultItem[];
  answer?: string;
  detail?: { error?: string } | string;
}

function parseSearchDepthFromEnv(): TavilySearchDepth {
  const raw = process.env.TAVILY_SEARCH_DEPTH?.trim().toLowerCase();
  if (raw && SEARCH_DEPTHS.has(raw)) {
    return raw as TavilySearchDepth;
  }
  return 'basic';
}

function parseMaxResultsFromEnv(): number {
  const raw = process.env.TAVILY_MAX_RESULTS?.trim();
  if (!raw) {
    return 5;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 20) {
    return 5;
  }
  return n;
}

function truncateDomains(domains: string[] | undefined, max: number): string[] {
  if (!domains?.length) {
    return [];
  }
  return domains.slice(0, max).map((d) => d.trim()).filter(Boolean);
}

/** Escapes `[` `]` `\` so link label text does not break `[label](url)` rendering. */
function escapeMarkdownLinkLabel(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

/**
 * Formats Tavily `results` into markdown with hyperlinks.
 */
export function formatTavilyResultsMarkdown(data: TavilySearchResponseBody): string {
  const lines: string[] = [];
  if (data.answer) {
    lines.push('**Summary**', '', data.answer, '');
  }
  const results = data.results ?? [];
  if (results.length === 0) {
    lines.push('No search results returned.');
    return lines.join('\n').trim();
  }
  lines.push('**Results**', '');
  for (const r of results) {
    const title = (r.title ?? 'Untitled').trim();
    const url = (r.url ?? '').trim();
    const snippet = (r.content ?? '').trim();
    if (url) {
      lines.push(`- [${escapeMarkdownLinkLabel(title)}](${url})`);
    } else {
      lines.push(`- ${escapeMarkdownLinkLabel(title)}`);
    }
    if (snippet) {
      lines.push(`  ${snippet.replace(/\n+/g, ' ')}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function extractErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (detail && typeof detail === 'object' && detail !== null && 'error' in detail) {
      const err = (detail as { error?: unknown }).error;
      if (typeof err === 'string') {
        return err;
      }
    }
    if (typeof detail === 'string') {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (first && typeof first === 'object' && first !== null && 'msg' in first) {
        const msg = (first as { msg?: unknown }).msg;
        if (typeof msg === 'string') {
          return msg;
        }
      }
    }
  }
  if (status === 401) {
    return 'Unauthorized: missing or invalid API key.';
  }
  if (status === 429) {
    return 'Rate limit exceeded. Try again later.';
  }
  return `Tavily search failed (HTTP ${status}).`;
}

/**
 * Calls Tavily Search API and returns markdown for the model or an error result.
 */
export async function tavilyWebSearch(input: TavilyWebSearchInput): Promise<ToolResult> {
  const {
    query,
    apiKey,
    allowed_domains,
    blocked_domains,
    searchDepth = parseSearchDepthFromEnv(),
    maxResults = parseMaxResultsFromEnv()
  } = input;

  const include_domains = truncateDomains(allowed_domains, TAVILY_MAX_INCLUDE_DOMAINS);
  const exclude_domains = truncateDomains(blocked_domains, TAVILY_MAX_EXCLUDE_DOMAINS);

  const body: Record<string, unknown> = {
    api_key: apiKey,
    query,
    search_depth: searchDepth,
    max_results: maxResults,
    include_domains,
    exclude_domains
  };

  try {
    const res = await fetch(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TAVILY_SEARCH_TIMEOUT_MS)
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      return {
        content: `Tavily search failed: invalid JSON response (HTTP ${res.status}).`,
        isError: true
      };
    }

    if (!res.ok) {
      const msg = extractErrorMessage(res.status, json);
      return {
        content: `Tavily search error: ${msg}`,
        isError: true
      };
    }

    const data = json as TavilySearchResponseBody;
    const markdown = formatTavilyResultsMarkdown(data);
    return { content: markdown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Tavily search failed: ${message}`,
      isError: true
    };
  }
}
