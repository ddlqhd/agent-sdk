import { z } from 'zod';
import { createTool } from '../registry.js';
import type { ToolDefinition } from '../../core/types.js';

/**
 * WebFetch 工具 - 获取网页内容
 */
export const webFetchTool = createTool({
  name: 'WebFetch',
  category: 'web',
  description: `Fetches content from a specified URL and converts it to readable markdown.

Usage:
- The URL must be a fully-formed valid URL
- HTTP URLs will be automatically upgraded to HTTPS
- This tool is read-only and does not modify any files
- Results may be summarized if the content is very large
- For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api)`,
  parameters: z.object({
    url: z.string().describe('The URL to fetch content from')
  }),
  handler: async ({ url }) => {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        return {
          content: `Failed to fetch: ${response.status} ${response.statusText}`,
          isError: true
        };
      }

      const html = await response.text();

      // Strip script and style tags, then convert to markdown
      const markdown = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
        .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
        .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
        .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
        .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
        .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
        .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
        .replace(/<pre[^>]*>(.*?)<\/pre>/gi, '```\n$1\n```')
        .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return { content: markdown };
    } catch (error) {
      return {
        content: `Error fetching webpage: ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      };
    }
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
