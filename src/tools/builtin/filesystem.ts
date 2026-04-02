import type { Readable } from 'node:stream';
import iconv from 'iconv-lite';
import fg from 'fast-glob';
import { z } from 'zod';
import { createTool } from '../registry.js';
import type { ToolDefinition } from '../../core/types.js';
import {
  detectEncodingFromSample,
  isNativeReadEncoding,
  isFilesystemEncodingSupported,
  normalizeFilesystemEncoding,
  readEncodingSample,
  readFileAsUnicodeString,
  writeFileFromUnicodeString
} from './filesystem-encoding.js';

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`;
const MAX_BYTES = 50 * 1024;
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`;

/**
 * Read 工具 - 读取文件内容
 */
export const readFileTool = createTool({
  name: 'Read',
  category: 'filesystem',
  description: `Reads a file from the local filesystem. You can access any file directly by using this tool.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Results are returned using cat -n style, with line numbers starting at 1
- Lines longer than 2000 characters are truncated
- Use the offset and limit parameters to read specific line ranges of large files
- If you read a file that exists but has empty contents you will receive an error message
- Text encoding is detected automatically from the file (BOM, UTF-8 validity, charset analysis). You rarely need to set encoding; use it only to override detection (e.g. gbk, gb18030, cp936 maps to gbk)`,
  parameters: z.object({
    file_path: z.string().describe('The absolute path to the file to read'),
    encoding: z
      .string()
      .optional()
      .describe(
        'Optional. Omit or use "auto" for automatic detection (default). Set only to force a specific encoding (utf8, gbk, gb18030, latin1, etc.; cp936 is treated as gbk).'
      ),
    offset: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('The line number to start reading from (1-indexed). Only provide if the file is too large to read at once'),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('The number of lines to read. Only provide if the file is too large to read at once')
  }),
  handler: async ({ file_path, encoding, offset, limit }) => {
    try {
      const fs = await import('fs/promises');
      const { createReadStream } = await import('fs');
      const { createInterface } = await import('readline');

      const stat = await fs.stat(file_path);
      if (!stat.isFile()) {
        return {
          content: `Error: ${file_path} is not a file`,
          isError: true
        };
      }

      const encTrim = encoding?.trim() ?? '';
      const useAuto = encTrim === '' || encTrim.toLowerCase() === 'auto';

      let normalized: string;
      let autoDetected = false;

      if (useAuto) {
        const sample = await readEncodingSample(file_path, stat.size);
        normalized = detectEncodingFromSample(sample);
        autoDetected = true;
      } else {
        normalized = normalizeFilesystemEncoding(encTrim);
        if (!isFilesystemEncodingSupported(normalized)) {
          return {
            content: `Error: unsupported encoding: ${encTrim}`,
            isError: true
          };
        }
      }

      const startLine = offset ? offset - 1 : 0;
      const maxLines = limit ?? DEFAULT_READ_LIMIT;

      const toDestroy: Readable[] = [];
      let lineInput: Readable;
      if (isNativeReadEncoding(normalized)) {
        const stream = createReadStream(file_path, {
          encoding: normalized as 'utf8' | 'utf16le' | 'latin1'
        });
        toDestroy.push(stream);
        lineInput = stream;
      } else {
        const raw = createReadStream(file_path);
        const decoded = raw.pipe(iconv.decodeStream(normalized)) as unknown as Readable;
        toDestroy.push(raw, decoded);
        lineInput = decoded;
      }

      const rl = createInterface({
        input: lineInput,
        crlfDelay: Infinity
      });

      const selectedLines: string[] = [];
      let totalLines = 0;
      let totalBytes = 0;
      let truncatedByBytes = false;
      let hasMoreLines = false;

      try {
        for await (const line of rl) {
          totalLines++;
          if (totalLines <= startLine) continue;

          if (selectedLines.length >= maxLines) {
            hasMoreLines = true;
            continue;
          }

          const processedLine =
            line.length > MAX_LINE_LENGTH
              ? line.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX
              : line;

          const lineBytes = Buffer.byteLength(processedLine, 'utf-8') + 1;
          if (totalBytes + lineBytes > MAX_BYTES) {
            truncatedByBytes = true;
            hasMoreLines = true;
            break;
          }

          selectedLines.push(processedLine);
          totalBytes += lineBytes;
        }
      } finally {
        rl.close();
        for (const s of toDestroy) {
          s.destroy();
        }
      }

      if (totalLines < startLine && !(totalLines === 0 && startLine === 0)) {
        return {
          content: `Error: Offset ${offset} is out of range for this file (${totalLines} lines)`,
          isError: true
        };
      }

      const numbered = selectedLines
        .map((line, i) => `${String(startLine + i + 1).padStart(5)}\t${line}`)
        .join('\n');

      const lastReadLine = startLine + selectedLines.length;
      const nextOffset = lastReadLine + 1;
      let suffix: string;

      if (truncatedByBytes) {
        suffix = `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${offset ?? 1}-${lastReadLine}. Use offset=${nextOffset} to continue.)`;
      } else if (hasMoreLines) {
        suffix = `\n\n(Showing lines ${offset ?? 1}-${lastReadLine} of ${totalLines}. Use offset=${nextOffset} to continue.)`;
      } else {
        suffix = `\n\n(End of file - total ${totalLines} lines)`;
      }

      if (autoDetected) {
        suffix += `\n\n(Auto-detected encoding: ${normalized}.)`;
      }

      return { content: numbered + suffix };
    } catch (error) {
      return {
        content: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      };
    }
  }
});

/**
 * Write 工具 - 写入文件
 */
export const writeFileTool = createTool({
  name: 'Write',
  category: 'filesystem',
  description: `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked
- For non-UTF-8 files (e.g. GBK on Windows), set encoding to match what you use with Read; default is utf8`,
  parameters: z.object({
    file_path: z.string().describe('The absolute path to the file to write (must be absolute, not relative)'),
    content: z.string().describe('The content to write to the file'),
    encoding: z
      .string()
      .optional()
      .describe(
        'File character encoding. Default utf8. Use gbk or gb18030 for legacy Chinese ANSI text; cp936 is treated as gbk.'
      )
  }),
  handler: async ({ file_path, content, encoding }) => {
    try {
      const fs = await import('fs/promises');
      const pathModule = await import('path');

      const normalized = normalizeFilesystemEncoding(encoding);
      if (!isFilesystemEncodingSupported(normalized)) {
        return {
          content: `Error: unsupported encoding: ${encoding?.trim() || 'utf8'}`,
          isError: true
        };
      }

      const dir = pathModule.dirname(file_path);
      await fs.mkdir(dir, { recursive: true });

      await writeFileFromUnicodeString(file_path, content, normalized);
      return { content: `Successfully wrote to ${file_path}` };
    } catch (error) {
      return {
        content: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      };
    }
  }
});

/**
 * Edit 工具 - 精确编辑文件
 */
export const editTool = createTool({
  name: 'Edit',
  category: 'filesystem',
  description: `Performs exact string replacements in files.

Usage:
- You must use the Read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + tab. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked
- The edit will FAIL if old_string is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use replace_all to change every instance of old_string
- Use replace_all for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance
- For non-UTF-8 files, set encoding to the same value you used with Read (default is utf8)`,
  parameters: z.object({
    file_path: z.string().describe('The absolute path to the file to modify'),
    old_string: z.string().describe('The text to replace'),
    new_string: z.string().describe('The text to replace it with (must be different from old_string)'),
    replace_all: z
      .boolean()
      .default(false)
      .describe('Replace all occurrences of old_string (default false)'),
    encoding: z
      .string()
      .optional()
      .describe(
        'File character encoding. Default utf8. Use gbk or gb18030 for legacy Chinese ANSI text; cp936 is treated as gbk.'
      )
  }),
  handler: async ({ file_path, old_string, new_string, replace_all, encoding }) => {
    try {
      if (old_string === new_string) {
        return {
          content: 'old_string and new_string must be different',
          isError: true
        };
      }

      const normalized = normalizeFilesystemEncoding(encoding);
      if (!isFilesystemEncodingSupported(normalized)) {
        return {
          content: `Error: unsupported encoding: ${encoding?.trim() || 'utf8'}`,
          isError: true
        };
      }

      const content = await readFileAsUnicodeString(file_path, normalized);

      if (!content.includes(old_string)) {
        return {
          content: `old_string not found in ${file_path}`,
          isError: true
        };
      }

      if (!replace_all) {
        const occurrences = content.split(old_string).length - 1;
        if (occurrences > 1) {
          return {
            content: `Found ${occurrences} matches for old_string. Provide more context to make it unique, or set replace_all to true.`,
            isError: true
          };
        }
      }

      const newContent = replace_all
        ? content.replaceAll(old_string, new_string)
        : content.replace(old_string, new_string);

      await writeFileFromUnicodeString(file_path, newContent, normalized);

      const occurrences = replace_all
        ? content.split(old_string).length - 1
        : 1;
      return {
        content: `Successfully edited ${file_path} (${occurrences} replacement${occurrences > 1 ? 's' : ''})`
      };
    } catch (error) {
      return {
        content: `Error editing file: ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      };
    }
  }
});

/**
 * Glob 工具 - 文件模式匹配
 */
export const globTool = createTool({
  name: 'Glob',
  category: 'filesystem',
  description: `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts" (use forward slashes in patterns; works on Windows)
- Returns matching file paths as absolute paths, sorted by modification time (newest first)
- Dotfiles and dot-directories are excluded unless the pattern targets them (starts with "." or contains "/.")
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`,
  parameters: z.object({
    pattern: z.string().describe('The glob pattern to match files against'),
    path: z
      .string()
      .optional()
      .describe('The directory to search in. If omitted, uses the agent working directory when available, otherwise the current process directory. IMPORTANT: Omit this field to use the default directory. Must be a valid directory path if provided.')
  }),
  handler: async ({ pattern, path: searchPath }, context) => {
    try {
      const fs = await import('fs/promises');
      const pathModule = await import('path');

      const rootDir = pathModule.resolve(searchPath || context?.projectDir || '.');
      const normalizedPattern = pattern.replace(/\\/g, '/');
      const includeDotfiles =
        normalizedPattern.startsWith('.') || normalizedPattern.includes('/.');

      const entries = await fg(normalizedPattern, {
        cwd: rootDir,
        onlyFiles: true,
        absolute: true,
        dot: includeDotfiles,
        suppressErrors: true
      });

      const matches: Array<{ path: string; mtime: number }> = [];
      for (const filePath of entries) {
        const nativePath = pathModule.normalize(filePath);
        try {
          const stat = await fs.stat(nativePath);
          if (stat.isFile()) {
            matches.push({ path: nativePath, mtime: stat.mtimeMs });
          }
        } catch {
          // Race: removed between glob and stat
        }
      }

      matches.sort((a, b) => b.mtime - a.mtime);

      return {
        content: matches.length > 0 ? matches.map((m) => m.path).join('\n') : 'No files found'
      };
    } catch (error) {
      return {
        content: `Error searching files: ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      };
    }
  }
});

/**
 * 获取所有文件系统工具
 */
export function getFileSystemTools(): ToolDefinition[] {
  return [
    readFileTool,
    writeFileTool,
    editTool,
    globTool
  ];
}
