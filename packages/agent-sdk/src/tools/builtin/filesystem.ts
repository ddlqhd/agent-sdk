import path from 'node:path';
import { z } from 'zod';
import { formatEditToolError } from '@ddlqhd/agent-sdk-exec';
import { createTool } from '../registry.js';
import type { ToolDefinition } from '../../core/types.js';
import { isFilesystemEncodingSupported, normalizeFilesystemEncoding } from './filesystem-encoding.js';
import { resolveToolEnvironment } from '../../exec/tool-environment.js';

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_BYTES = 50 * 1024;
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`;

/**
 * Read 工具 - 读取文件内容
 */
export const readFileTool = createTool({
  name: 'Read',
  category: 'filesystem',
  description: `Reads human-readable text from the local filesystem: source code, configuration, logs, Markdown, and structured text (JSON, XML, YAML, etc.).

Do NOT use Read for binary formats. This tool decodes the file as text; for binaries the result is garbage or misleading. Examples: images (png, jpg, gif, webp, ico), Office/OpenXML (xlsx, docx, pptx), PDF, audio/video, archives (zip, gz, etc.), and compiled binaries. Prefer format-specific tooling, a small script or library in the user's environment, or ask the user for an exported/plain-text view.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Results are returned using cat -n style, with line numbers starting at 1
- Lines longer than 2000 characters are truncated
- Use the offset and limit parameters to read specific line ranges of large files
- An empty file (no lines) returns successfully with no numbered lines and a suffix noting zero total lines—it is not an error
- Text encoding is detected automatically from the file (BOM, UTF-8 validity, charset analysis). You rarely need to set encoding; use it only to override detection (e.g. gbk, gb18030, cp936 maps to gbk)`,
  parameters: z.object({
    file_path: z
      .string()
      .describe(
        'Absolute path to a text or text-decodable source file (not binary formats such as images, xlsx, or pdf).'
      ),
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
  handler: async ({ file_path, encoding, offset, limit }, context) => {
    try {
      const env = resolveToolEnvironment(context);
      const result = await env.fs.readText(file_path, {
        encoding,
        lineOffset: offset,
        lineLimit: limit ?? DEFAULT_READ_LIMIT,
        maxBytes: MAX_BYTES,
        maxLineLength: MAX_LINE_LENGTH
      });

      if (!result.isFile) {
        return {
          content: `Error: ${file_path} is not a file`,
          isError: true
        };
      }
      if (result.unsupportedEncoding) {
        return {
          content: `Error: unsupported encoding: ${result.unsupportedEncoding}`,
          isError: true
        };
      }

      const startLine = offset ? offset - 1 : 0;
      if (result.totalLines < startLine && !(result.totalLines === 0 && startLine === 0)) {
        return {
          content: `Error: Offset ${offset} is out of range for this file (${result.totalLines} lines)`,
          isError: true
        };
      }

      const numbered = result.lines
        .map((line: string, i: number) => `${String(result.startLine + i).padStart(5)}\t${line}`)
        .join('\n');

      const lastReadLine = result.startLine + result.lines.length - 1;
      const nextOffset = lastReadLine + 1;
      let suffix: string;

      if (result.truncatedByBytes) {
        suffix = `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${offset ?? 1}-${lastReadLine}. Use offset=${nextOffset} to continue.)`;
      } else if (result.hasMoreLines) {
        suffix = `\n\n(Showing lines ${offset ?? 1}-${lastReadLine} of ${result.totalLines}. Use offset=${nextOffset} to continue.)`;
      } else {
        suffix = `\n\n(End of file - total ${result.totalLines} lines)`;
      }

      if (result.detectedEncoding) {
        suffix += `\n\n(Auto-detected encoding: ${result.detectedEncoding}.)`;
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
  handler: async ({ file_path, content, encoding }, context) => {
    try {
      const normalized = normalizeFilesystemEncoding(encoding);
      if (!isFilesystemEncodingSupported(normalized)) {
        return {
          content: `Error: unsupported encoding: ${encoding?.trim() || 'utf8'}`,
          isError: true
        };
      }

      const env = resolveToolEnvironment(context);
      await env.fs.writeText(file_path, content, { encoding: normalized, mkdir: true });
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
- Files at or above 1 GiB cannot be edited with this tool (use another workflow for huge files)
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + tab. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string
- old_string may use \\n line breaks; CRLF files are matched and new_string is rewritten to the file's dominant line ending style (\\r\\n vs \\n)
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked
- The edit will FAIL if old_string is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use replace_all to change every instance of old_string
- Use replace_all for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance
- For non-UTF-8 files, set encoding to the same value you used with Read (default is utf8)`,
  parameters: z.object({
    file_path: z.string().describe('The absolute path to the file to modify'),
    old_string: z.string().min(1).describe('The text to replace (non-empty)'),
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
  handler: async ({ file_path, old_string, new_string, replace_all, encoding }, context) => {
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

      const env = resolveToolEnvironment(context);
      const { occurrences } = await env.fs.edit(file_path, {
        oldString: old_string,
        newString: new_string,
        replaceAll: replace_all,
        encoding: normalized
      });

      return {
        content: `Successfully edited ${file_path} (${occurrences} replacement${occurrences > 1 ? 's' : ''})`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: formatEditToolError(message),
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
      const env = resolveToolEnvironment(context);
      const rootDir = path.resolve(searchPath || context?.projectDir || env.info.cwd || '.');
      const normalizedPattern = pattern.replace(/\\/g, '/');
      const includeDotfiles =
        normalizedPattern.startsWith('.') || normalizedPattern.includes('/.');

      const matches = await env.fs.glob(normalizedPattern, {
        cwd: rootDir,
        includeDotfiles
      });

      return {
        content: matches.length > 0 ? matches.map((m: { path: string }) => m.path).join('\n') : 'No files found'
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
