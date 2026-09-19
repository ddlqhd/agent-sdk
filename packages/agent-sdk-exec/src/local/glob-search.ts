import path from 'node:path';
import { promises as fs } from 'node:fs';
import fg from 'fast-glob';
import ignore from 'ignore';
import micromatch from 'micromatch';
import type { GlobMatch, SearchOptions, SearchResult } from '../environment.js';

const FG_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/__pycache__/**'
] as const;

export const DEFAULT_GREP_HEAD_LIMIT = 250;
export const MAX_GREP_LINE_LENGTH = 2000;

export function truncateMatchLineForDisplay(line: string, regex: RegExp): string {
  const max = MAX_GREP_LINE_LENGTH;
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

export async function globFiles(
  pattern: string,
  cwd: string,
  includeDotfiles?: boolean
): Promise<GlobMatch[]> {
  const normalizedPattern = pattern.replace(/\\/g, '/');
  const entries = await fg(normalizedPattern, {
    cwd,
    onlyFiles: true,
    absolute: true,
    dot: includeDotfiles === true,
    suppressErrors: true
  });

  const matches: GlobMatch[] = [];
  for (const filePath of entries) {
    const nativePath = path.normalize(filePath);
    try {
      const stat = await fs.stat(nativePath);
      if (stat.isFile()) {
        matches.push({ path: nativePath, mtimeMs: stat.mtimeMs });
      }
    } catch {
      // Race: removed between glob and stat
    }
  }
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches;
}

export async function searchFiles(opts: SearchOptions): Promise<SearchResult> {
  const projectBase = path.resolve(opts.projectDir ?? process.cwd());
  const resolvedRoot = path.resolve(opts.path);
  const headLimit = opts.headLimit ?? DEFAULT_GREP_HEAD_LIMIT;
  const context = opts.context ?? 0;

  let stat;
  try {
    stat = await fs.stat(resolvedRoot);
  } catch {
    return { ok: false, content: `Path does not exist: ${opts.path}` };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(opts.pattern, opts.caseInsensitive ? 'i' : '');
  } catch (e) {
    return {
      ok: false,
      content: `Invalid regex pattern: ${e instanceof Error ? e.message : String(e)}`
    };
  }

  let filesToSearch: string[] = [];

  if (stat.isFile()) {
    if (opts.glob) {
      const rel = path.relative(projectBase, resolvedRoot).split(path.sep).join('/');
      if (!micromatch.isMatch(rel, opts.glob, { posix: true })) {
        return { ok: true, content: 'No matches found (path does not match glob filter)' };
      }
    }
    filesToSearch = [resolvedRoot];
  } else {
    const absolutePaths = await fg.glob(opts.glob ?? '**/*', {
      cwd: resolvedRoot,
      onlyFiles: true,
      dot: false,
      ignore: [...FG_IGNORE],
      absolute: true
    });

    let ig: ReturnType<typeof ignore> | null = null;
    try {
      const giContent = await fs.readFile(path.join(resolvedRoot, '.gitignore'), 'utf-8');
      ig = ignore().add(giContent);
    } catch {
      /* no or unreadable root .gitignore */
    }

    filesToSearch = absolutePaths.filter((abs) => {
      const rel = path.relative(resolvedRoot, abs).split(path.sep).join('/');
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
    const relDisplay = path.relative(resolvedRoot, filePath).split(path.sep).join('/');
    const displayPath = relDisplay || path.basename(filePath);

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i]!)) {
        totalMatches++;
        const matchLineOut = truncateMatchLineForDisplay(lines[i]!, regex);

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

        if (totalMatches >= headLimit) break;
      }
    }

    if (totalMatches >= headLimit) break;
  }

  if (results.length === 0) {
    return { ok: true, content: 'No matches found' };
  }

  if (results[results.length - 1] === '--') {
    results.pop();
  }

  const suffix =
    totalMatches >= headLimit
      ? `\n\n(Showing first ${headLimit} matches)`
      : `\n\n(${totalMatches} matches)`;

  return { ok: true, content: results.join('\n') + suffix };
}
