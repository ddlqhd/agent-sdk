import path from 'node:path';
import { z } from 'zod';
import { createTool } from '../registry.js';
import type { ToolDefinition } from '../../core/types.js';
import { resolveToolEnvironment } from '../../exec/tool-environment.js';
import {
  DEFAULT_GREP_HEAD_LIMIT,
  MAX_GREP_LINE_LENGTH,
  truncateMatchLineForDisplay
} from '@ddlqhd/agent-sdk-exec';

/** Default cap on number of matching lines returned (each line counts as one match). */
export { DEFAULT_GREP_HEAD_LIMIT };

/** Max characters for a single match line in output (match-aware window, see {@link truncateMatchLineForDisplay}). */
export const MAX_LINE_LENGTH = MAX_GREP_LINE_LENGTH;

export { truncateMatchLineForDisplay };

export const grepTool = createTool({
  name: 'Grep',
  category: 'search',
  description: `Search file contents with ECMAScript regular expressions (line-by-line, pure Node.js; does not spawn ripgrep/grep).

Usage:
- ALWAYS use Grep for search tasks. NEVER invoke grep or rg as a Bash command.
- Uses JavaScript RegExp semantics (not PCRE/ripgrep); very complex patterns may differ from rg.
- Filter files with glob (e.g. "*.js", "**/*.{ts,tsx}"); brace expansion is supported.
- Root directory search respects a .gitignore file at the search root when present.
- Long match lines are truncated with a window centered on the match (max ${MAX_LINE_LENGTH} chars).
- Use the Agent tool for open-ended searches requiring multiple rounds.
- Output: matching lines with file paths and line numbers`,

  parameters: z.object({
    pattern: z.string().describe('The regular expression pattern to search for in file contents'),
    path: z
      .string()
      .optional()
      .describe('File or directory to search in. Defaults to the agent working directory when available, otherwise current process directory.'),
    glob: z
      .string()
      .optional()
      .describe('Glob pattern to filter files (e.g. "*.js", "**/*.{ts,tsx}")'),
    case_insensitive: z
      .boolean()
      .default(false)
      .describe('Case insensitive search'),
    context: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Number of lines to show before and after each match'),
    head_limit: z
      .number()
      .int()
      .min(1)
      .default(DEFAULT_GREP_HEAD_LIMIT)
      .describe(`Limit to the first N matching lines. Defaults to ${DEFAULT_GREP_HEAD_LIMIT}.`)
  }),

  handler: async (
    { pattern, path: searchPath, glob: globParam, case_insensitive, context, head_limit },
    toolContext
  ) => {
    try {
      const env = resolveToolEnvironment(toolContext);
      const rootPathRaw = searchPath || toolContext?.projectDir || env.info.cwd || '.';
      const resolvedRoot = path.resolve(rootPathRaw);
      const projectBase = path.resolve(toolContext?.projectDir ?? env.info.cwd ?? process.cwd());

      const result = await env.fs.search({
        pattern,
        path: resolvedRoot,
        projectDir: projectBase,
        glob: globParam,
        caseInsensitive: case_insensitive,
        context,
        headLimit: head_limit
      });

      return { content: result.content, isError: result.ok === false };
    } catch (error) {
      return {
        content: `Error searching: ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      };
    }
  }
});

/**
 * 获取 Grep 工具
 */
export function getGrepTools(): ToolDefinition[] {
  return [grepTool];
}
