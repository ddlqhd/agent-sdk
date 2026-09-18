import { z } from 'zod';
import fg from 'fast-glob';
import ignore from 'ignore';
import micromatch from 'micromatch';
import { createTool } from '../registry.js';
import type { ToolDefinition } from '../../core/types.js';

/** Default cap on number of matching lines returned (each line counts as one match). */
export const DEFAULT_GREP_HEAD_LIMIT = 250;

/** Max characters for a single match line in output (match-aware window, see {@link truncateMatchLineForDisplay}). */
export const MAX_LINE_LENGTH = 2000;

const FG_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/__pycache__/**'
] as const;

/**
 * Shorten a long line for Grep output while keeping the first regex match visible (not a fixed [0, MAX) slice).
 * Context lines (when using `context` > 0) are not passed through this function.
 */
export function truncateMatchLineForDisplay(line: string, regex: RegExp): string {
  const max = MAX_LINE_LENGTH;
  if (line.length <= max) {
    return line;
  }

  const safeFlags = regex.flags.replace(/g/g, '').replace(/y/g, '');
  const re = new RegExp(regex.source, safeFlags);
  const m = re.exec(line);
  if (!m || m.index === undefined) {
    return line.slice(0, max) + '...';
  }

  const matchStart = m.index;
  const matchEnd = m.index + m[0].length;
  const matchLen = matchEnd - matchStart;
  if (matchLen >= max) {
    return m[0].slice(0, max) + '...';
  }

  let start = matchStart - Math.floor((max - matchLen) / 2);
  let end = start + max;

  if (start < 0) {
    start = 0;
    end = max;
  }
  if (end > line.length) {
    end = line.length;
    start = end - max;
  }
  if (start < 0) {
    start = 0;
  }

  if (matchStart < start) {
    start = Math.max(0, matchEnd - max);
    end = Math.min(line.length, start + max);
  }
  if (matchEnd > end) {
    end = line.length;
    start = Math.max(0, end - max);
  }

  const slice = line.slice(start, end);
  return (start > 0 ? '...' : '') + slice + (end < line.length ? '...' : '');
}

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
      const fs = await import('fs/promises');
      const pathModule = await import('path');

      const projectBase = pathModule.resolve(toolContext?.projectDir ?? process.cwd());
      const rootPathRaw = searchPath || toolContext?.projectDir || '.';
      const resolvedRoot = pathModule.resolve(rootPathRaw);

      let stat;
      try {
        stat = await fs.stat(resolvedRoot);
      } catch {
        return {
          content: `Path does not exist: ${rootPathRaw}`,
          isError: true
        };
      }

      let regex: RegExp;
      try {
        regex = new RegExp(pattern, case_insensitive ? 'i' : '');
      } catch (e) {
        return {
          content: `Invalid regex pattern: ${e instanceof Error ? e.message : String(e)}`,
          isError: true
        };
      }

      let filesToSearch: string[] = [];

      if (stat.isFile()) {
        if (globParam) {
          const rel = pathModule.relative(projectBase, resolvedRoot).split(pathModule.sep).join('/');
          if (!micromatch.isMatch(rel, globParam, { posix: true })) {
            return {
              content: 'No matches found (path does not match glob filter)'
            };
          }
        }
        filesToSearch = [resolvedRoot];
      } else {
        const absolutePaths = await fg.glob(globParam ?? '**/*', {
          cwd: resolvedRoot,
          onlyFiles: true,
          dot: false,
          ignore: [...FG_IGNORE],
          absolute: true
        });

        let ig: ReturnType<typeof ignore> | null = null;
        try {
          const giContent = await fs.readFile(pathModule.join(resolvedRoot, '.gitignore'), 'utf-8');
          ig = ignore().add(giContent);
        } catch {
          /* no or unreadable root .gitignore */
        }

        filesToSearch = absolutePaths.filter((abs) => {
          const rel = pathModule.relative(resolvedRoot, abs).split(pathModule.sep).join('/');
          if (!rel || rel.startsWith('..')) {
            return true;
          }
          return !(ig && ig.ignores(rel));
        });
      }

      const results: string[] = [];
      let totalMatches = 0;

      for (const filePath of filesToSearch) {
        let content: string;
        try {
          content = await fs.readFile(filePath, 'utf-8');
        } catch {
          continue;
        }

        const lines = content.split('\n');
        const relDisplay = pathModule.relative(resolvedRoot, filePath).split(pathModule.sep).join('/');
        const displayPath = relDisplay || pathModule.basename(filePath);

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            totalMatches++;

            const matchLineOut = truncateMatchLineForDisplay(lines[i], regex);

            if (context > 0) {
              const start = Math.max(0, i - context);
              const end = Math.min(lines.length - 1, i + context);

              if (start < i) {
                for (let j = start; j < i; j++) {
                  results.push(`${displayPath}:${j + 1}-${lines[j]}`);
                }
              }
              results.push(`${displayPath}:${i + 1}:${matchLineOut}`);
              if (end > i) {
                for (let j = i + 1; j <= end; j++) {
                  results.push(`${displayPath}:${j + 1}-${lines[j]}`);
                }
              }
              results.push('--');
            } else {
              results.push(`${displayPath}:${i + 1}:${matchLineOut}`);
            }

            if (totalMatches >= head_limit) break;
          }
        }

        if (totalMatches >= head_limit) break;
      }

      if (results.length === 0) {
        return { content: 'No matches found' };
      }

      if (results[results.length - 1] === '--') {
        results.pop();
      }

      const output = results.join('\n');
      const suffix =
        totalMatches >= head_limit
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
