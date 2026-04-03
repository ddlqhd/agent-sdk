import { z } from 'zod';
import { createTool } from '../registry.js';
import type { ToolDefinition } from '../../core/types.js';
import { fetchUrlToReadableContent } from './web-fetch.js';

/**
 * WebFetch 工具 - 获取网页内容
 */
export const webFetchTool = createTool({
  name: 'WebFetch',
  category: 'web',
  description: `Fetches public http(s) URLs and returns readable markdown (HTML), formatted JSON, or plain text.

Limits and behavior:
- Only http:// and https:// are allowed; private IPs, loopback, link-local, and common metadata/local hostnames are blocked (SSRF protection).
- Requests time out, responses are size-capped, and very long markdown may be truncated before return.
- If the result exceeds the direct context limit, the full text is saved under your user tool-outputs directory; the tool response will include the file path—use **Read** with offset and limit parameters to page through it (same pattern as large shell output).
- Authenticated or private pages usually cannot be fetched; prefer specialized MCP tools when available.
- Use https URLs directly when possible (no automatic http→https upgrade).
- For GitHub URLs, prefer the gh CLI via Bash when appropriate (e.g., gh pr view, gh api).`,
  parameters: z.object({
    url: z.string().describe('The URL to fetch content from')
  }),
  handler: async ({ url }) => {
    const result = await fetchUrlToReadableContent(url);
    return result.isError
      ? { content: result.content, isError: true }
      : { content: result.content };
  }
});

/**
 * WebSearch 工具 - 网络搜索
 */
export const webSearchTool = createTool({
  name: 'WebSearch',
  category: 'web',
  description: `- Allows searching the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information with links as markdown hyperlinks
- Use this tool for accessing information beyond the knowledge cutoff
- Requires a search handler to be configured`,
  parameters: z.object({
    query: z.string().min(2).describe('The search query to use'),
    allowed_domains: z
      .array(z.string())
      .optional()
      .describe('Only include search results from these domains'),
    blocked_domains: z
      .array(z.string())
      .optional()
      .describe('Never include search results from these domains')
  }),
  handler: async ({ query }) => {
    return {
      content: `Web search is not configured. To enable WebSearch, register a custom tool with your preferred search provider (e.g., Exa, Brave, Google, DuckDuckGo). Query was: "${query}"`,
      isError: true
    };
  }
});

/**
 * 获取所有 Web 工具
 */
export function getWebTools(): ToolDefinition[] {
  return [webFetchTool, webSearchTool];
}
