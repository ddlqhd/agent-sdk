import { z } from 'zod';
import { createTool } from '../registry.js';
import type { ToolDefinition } from '../../core/types.js';

/**
 * Grep 工具 - 内容搜索
 */
export const grepTool = createTool({
  name: 'Grep',
  category: 'search',
  description: `A powerful search tool built on ripgrep

Usage:
- ALWAYS use Grep for search tasks. NEVER invoke grep or rg as a Bash command. The Grep tool has been optimized for correct permissions and access.
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx")
- Use Agent tool for open-ended searches requiring multiple rounds
- Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping
- Output: Returns matching lines with file paths and line numbers`,
  parameters: z.object({
    pattern: z.string().describe('The regular expression pattern to search for in file contents'),
    path: z
      .string()
      .optional()
      .describe('File or directory to search in. Defaults to the agent working directory when available, otherwise current process directory.'),
    glob: z
      .string()
      .optional()
      .describe('Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")'),
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
      .optional()
      .describe('Limit output to first N results. Defaults to 250 when unspecified.')
  }),
  handler: async ({ pattern, path: searchPath, glob, case_insensitive, context, head_limit }, toolContext) => {
    try {
      const fs = await import('fs/promises');
      const pathModule = await import('path');

      const rootPath = searchPath || toolContext?.projectDir || '.';

      // Check if rootPath is a file or directory
      let stat;
      try {
        stat = await fs.stat(rootPath);
      } catch {
        return {
          content: `Path does not exist: ${rootPath}`,
          isError: true
        };
      }

      const filesToSearch: string[] = [];

      if (stat.isFile()) {
        filesToSearch.push(rootPath);
      } else {
        // Walk directory collecting files matching glob
        const globRegex = glob
          ? new RegExp(
              '^' +
                glob
                  .replace(/\./g, '\\.')
                  .replace(/\*\*/g, '{{GLOBSTAR}}')
                  .replace(/\*/g, '[^/]*')
                  .replace(/\{\{GLOBSTAR\}\}/g, '.*')
                  .replace(/\?/g, '[^/]') +
                '$'
            )
          : null;

        async function walk(dir: string) {
          let entries;
          try {
            entries = await fs.readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }

          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const fullPath = pathModule.join(dir, entry.name);

            if (entry.isDirectory()) {
              if (['node_modules', '.git', 'dist', 'build', '__pycache__'].includes(entry.name)) {
                continue;
              }
              await walk(fullPath);
            } else if (entry.isFile()) {
              if (globRegex) {
                const relative = pathModule.relative(rootPath, fullPath).split(pathModule.sep).join('/');
                if (!globRegex.test(relative)) continue;
              }
              filesToSearch.push(fullPath);
            }
          }
        }

        await walk(rootPath);
      }

      // Compile regex
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, case_insensitive ? 'i' : '');
      } catch (e) {
        return {
          content: `Invalid regex pattern: ${e instanceof Error ? e.message : String(e)}`,
          isError: true
        };
      }

      const results: string[] = [];
      let totalMatches = 0;

      for (const filePath of filesToSearch) {
        let content: string;
        try {
          content = await fs.readFile(filePath, 'utf-8');
        } catch {
          continue; // Skip binary or unreadable files
        }

        const lines = content.split('\n');
        const displayPath = pathModule.relative(rootPath, filePath).split(pathModule.sep).join('/');

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            totalMatches++;

            if (context > 0) {
              const start = Math.max(0, i - context);
              const end = Math.min(lines.length - 1, i + context);

              if (start < i) {
                for (let j = start; j < i; j++) {
                  results.push(`${displayPath}:${j + 1}-${lines[j]}`);
                }
              }
              results.push(`${displayPath}:${i + 1}:${lines[i]}`);
              if (end > i) {
                for (let j = i + 1; j <= end; j++) {
                  results.push(`${displayPath}:${j + 1}-${lines[j]}`);
                }
              }
              results.push('--');
            } else {
              results.push(`${displayPath}:${i + 1}:${lines[i]}`);
            }

            if (head_limit && totalMatches >= head_limit) break;
          }
        }

        if (head_limit && totalMatches >= head_limit) break;
      }

      if (results.length === 0) {
        return { content: 'No matches found' };
      }

      // Remove trailing separator
      if (results[results.length - 1] === '--') {
        results.pop();
      }

      const output = results.join('\n');
      const suffix =
        head_limit && totalMatches >= head_limit
          ? `\n\n(Showing first ${head_limit} matches)`
          : `\n\n(${totalMatches} matches)`;

      return { content: output + suffix };
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
