import { createReadStream, promises as fs, type Stats } from 'node:fs';
import type { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import iconv from 'iconv-lite';
import path from 'node:path';
import { assertWithinRoot } from '../path-guard.js';
import type {
  DirEntry,
  EditOptions,
  EditResult,
  FileStat,
  FileSystem,
  GlobMatch,
  GlobOptions,
  ReadFileOptions,
  ReadTextOptions,
  ReadTextResult,
  SearchOptions,
  SearchResult,
  SpillTextOptions,
  SpillTextResult,
  WriteTextOptions
} from '../environment.js';
import {
  detectEncodingFromSample,
  isFilesystemEncodingSupported,
  isNativeReadEncoding,
  normalizeFilesystemEncoding,
  readEncodingSample,
  readFileAsUnicodeString,
  writeFileFromUnicodeString
} from './encoding.js';
import { globFiles, searchFiles } from './glob-search.js';
import {
  EDIT_MAX_FILE_BYTES,
  buildNeedleCandidates,
  countOccurrences,
  detectDominantEol,
  normalizeNewStringEols,
  replaceNonOverlapping
} from './edit.js';
import {
  SPILL_MAX_DIRECT_CHARS,
  SPILL_MAX_STORAGE_CHARS,
  formatSpilledToolOutput,
  spillFileName
} from './spill.js';

const DEFAULT_LINE_LIMIT = 2000;
const DEFAULT_MAX_LINE_LENGTH = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024;

function toFileStat(stat: Stats): FileStat {
  return {
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

export class LocalFileSystem implements FileSystem {
  constructor(
    private readonly workspaceRoot?: string,
    private readonly extraRoots: string[] = [],
    private readonly extraWriteRoots: string[] = [],
    private readonly toolOutputsRoot?: string
  ) {}

  resolve(target: string): string {
    return assertWithinRoot(this.workspaceRoot, target, this.extraRoots);
  }

  private resolveWrite(target: string): string {
    return assertWithinRoot(this.workspaceRoot, target, this.extraWriteRoots);
  }

  async stat(filePath: string): Promise<FileStat> {
    return toFileStat(await fs.stat(this.resolve(filePath)));
  }

  async readFile(filePath: string, opts?: ReadFileOptions): Promise<Uint8Array> {
    const resolved = this.resolve(filePath);
    if (opts?.offset !== undefined || opts?.length !== undefined) {
      const fh = await fs.open(resolved, 'r');
      try {
        const size = (await fh.stat()).size;
        const offset = opts.offset ?? 0;
        const length = Math.min(opts.length ?? size - offset, Math.max(0, size - offset));
        if (length <= 0) {
          return new Uint8Array();
        }
        const buf = Buffer.allocUnsafe(length);
        const { bytesRead } = await fh.read(buf, 0, length, offset);
        return bytesRead < length ? buf.subarray(0, bytesRead) : buf;
      } finally {
        await fh.close();
      }
    }
    const buf = await fs.readFile(resolved);
    return new Uint8Array(buf);
  }

  async writeFile(filePath: string, data: Uint8Array, opts?: { mkdir?: boolean }): Promise<void> {
    const resolved = this.resolveWrite(filePath);
    if (opts?.mkdir !== false) {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
    }
    await fs.writeFile(resolved, Buffer.from(data));
  }

  async mkdir(dirPath: string, opts?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(this.resolveWrite(dirPath), { recursive: opts?.recursive !== false });
  }

  async readDir(dirPath: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(this.resolve(dirPath), { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isFile: e.isFile(),
      isDirectory: e.isDirectory()
    }));
  }

  async canonicalize(filePath: string): Promise<string> {
    return fs.realpath(this.resolve(filePath));
  }

  async remove(filePath: string, opts?: { recursive?: boolean }): Promise<void> {
    await fs.rm(this.resolveWrite(filePath), { recursive: opts?.recursive === true, force: true });
  }

  async copy(src: string, dest: string): Promise<void> {
    await fs.cp(this.resolve(src), this.resolveWrite(dest), { recursive: true });
  }

  async readText(filePath: string, opts?: ReadTextOptions): Promise<ReadTextResult> {
    const resolved = this.resolve(filePath);
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return {
        isFile: false,
        size: stat.size,
        encoding: 'utf8',
        lines: [],
        startLine: 1,
        totalLines: 0,
        truncatedByBytes: false,
        hasMoreLines: false
      };
    }

    const encTrim = opts?.encoding?.trim() ?? '';
    const useAuto = encTrim === '' || encTrim.toLowerCase() === 'auto';
    let normalized: string;
    let detectedEncoding: string | undefined;

    if (useAuto) {
      const sample = await readEncodingSample(resolved, stat.size);
      normalized = detectEncodingFromSample(sample);
      detectedEncoding = normalized;
    } else {
      normalized = normalizeFilesystemEncoding(encTrim);
      if (!isFilesystemEncodingSupported(normalized)) {
        return {
          isFile: true,
          size: stat.size,
          encoding: normalized,
          unsupportedEncoding: encTrim,
          lines: [],
          startLine: 1,
          totalLines: 0,
          truncatedByBytes: false,
          hasMoreLines: false
        };
      }
    }

    const paginate = opts?.lineOffset !== undefined || opts?.lineLimit !== undefined || opts?.maxBytes !== undefined;
    if (!paginate) {
      const text = await readFileAsUnicodeString(resolved, normalized);
      const lines = text.length === 0 ? [] : text.split('\n');
      return {
        isFile: true,
        size: stat.size,
        encoding: normalized,
        detectedEncoding,
        text,
        lines,
        startLine: 1,
        totalLines: lines.length,
        truncatedByBytes: false,
        hasMoreLines: false
      };
    }

    const startLine = opts?.lineOffset ? opts.lineOffset - 1 : 0;
    const maxLines = opts?.lineLimit ?? DEFAULT_LINE_LIMIT;
    const maxLineLength = opts?.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
    const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
    const lineSuffix = `... (line truncated to ${maxLineLength} chars)`;

    const toDestroy: Readable[] = [];
    let lineInput: Readable;
    if (isNativeReadEncoding(normalized)) {
      const stream = createReadStream(resolved, {
        encoding: normalized as 'utf8' | 'utf16le' | 'latin1'
      });
      toDestroy.push(stream);
      lineInput = stream;
    } else {
      const raw = createReadStream(resolved);
      const decoded = raw.pipe(iconv.decodeStream(normalized)) as unknown as Readable;
      toDestroy.push(raw, decoded);
      lineInput = decoded;
    }

    const rl = createInterface({ input: lineInput, crlfDelay: Infinity });
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
          line.length > maxLineLength ? line.substring(0, maxLineLength) + lineSuffix : line;
        const lineBytes = Buffer.byteLength(processedLine, 'utf-8') + 1;
        if (totalBytes + lineBytes > maxBytes) {
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

    return {
      isFile: true,
      size: stat.size,
      encoding: normalized,
      detectedEncoding,
      lines: selectedLines,
      startLine: startLine + 1,
      totalLines,
      truncatedByBytes,
      hasMoreLines
    };
  }

  async writeText(filePath: string, text: string, opts?: WriteTextOptions): Promise<void> {
    const resolved = this.resolveWrite(filePath);
    const normalized = normalizeFilesystemEncoding(opts?.encoding);
    if (!isFilesystemEncodingSupported(normalized)) {
      throw new Error(`unsupported encoding: ${opts?.encoding?.trim() || 'utf8'}`);
    }
    if (opts?.mkdir !== false) {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
    }
    await writeFileFromUnicodeString(resolved, text, normalized);
  }

  async glob(pattern: string, opts: GlobOptions): Promise<GlobMatch[]> {
    const cwd = this.resolve(opts.cwd);
    return globFiles(pattern, cwd, opts.includeDotfiles);
  }

  async search(opts: SearchOptions): Promise<SearchResult> {
    return searchFiles({
      ...opts,
      path: this.resolve(opts.path),
      projectDir: opts.projectDir ? this.resolve(opts.projectDir) : this.workspaceRoot
    });
  }

  async edit(filePath: string, opts: EditOptions): Promise<EditResult> {
    if (opts.oldString === opts.newString) {
      throw new Error('old_string and new_string must be different');
    }

    const normalized = normalizeFilesystemEncoding(opts.encoding);
    if (!isFilesystemEncodingSupported(normalized)) {
      throw new Error(`Error: unsupported encoding: ${opts.encoding?.trim() || 'utf8'}`);
    }

    const stat = await this.stat(filePath);
    if (!stat.isFile) {
      throw new Error(`Error: ${filePath} is not a file`);
    }
    if (stat.size >= EDIT_MAX_FILE_BYTES) {
      throw new Error(
        `Error: file is too large to edit (${stat.size} bytes). Maximum size is ${EDIT_MAX_FILE_BYTES} bytes (1 GiB). Use a different tool or split the work.`
      );
    }

    const loaded = await this.readText(filePath, { encoding: normalized });
    if (loaded.unsupportedEncoding) {
      throw new Error(`Error: unsupported encoding: ${opts.encoding?.trim() || 'utf8'}`);
    }
    const content = loaded.text ?? loaded.lines.join('\n');

    const dominantEol = detectDominantEol(content);
    const candidates = buildNeedleCandidates(opts.oldString, dominantEol);
    let needle: string | null = null;
    for (const c of candidates) {
      if (countOccurrences(content, c) > 0) {
        needle = c;
        break;
      }
    }

    if (needle === null) {
      throw new Error(`old_string not found in ${filePath}`);
    }

    const occurrences = countOccurrences(content, needle);
    if (!opts.replaceAll && occurrences > 1) {
      throw new Error(
        `Found ${occurrences} matches for old_string. Provide more context to make it unique, or set replace_all to true.`
      );
    }

    const normalizedNew = normalizeNewStringEols(opts.newString, dominantEol);
    const newContent = replaceNonOverlapping(content, needle, normalizedNew, opts.replaceAll === true);
    await this.writeText(filePath, newContent, { encoding: normalized });
    return { occurrences };
  }

  async spillText(text: string, opts: SpillTextOptions): Promise<SpillTextResult> {
    const maxDirect = opts.maxDirectChars ?? SPILL_MAX_DIRECT_CHARS;
    const lineCount = text.split('\n').length;
    if (text.length <= maxDirect) {
      return {
        content: text,
        spilled: false,
        originalLength: text.length,
        lineCount
      };
    }

    const storageTruncated = text.length > SPILL_MAX_STORAGE_CHARS;
    const stored = storageTruncated ? text.slice(0, SPILL_MAX_STORAGE_CHARS) : text;
    const meta = { originalLength: text.length, lineCount, storageTruncated };
    const root = this.toolOutputsRoot;
    if (!root) {
      const formatted = formatSpilledToolOutput(stored, '(unavailable)', meta);
      return {
        content:
          `Output too large (${lineCount} lines)\n\n` +
          `Failed to save to file: tool-outputs root is not configured\n\n` +
          formatted.content,
        spilled: false,
        originalLength: text.length,
        lineCount,
        storageTruncated
      };
    }

    const filepath = path.join(root, spillFileName(opts.toolName));
    try {
      await this.writeText(filepath, stored, { mkdir: true });
      const formatted = formatSpilledToolOutput(stored, filepath, meta);
      return {
        content: formatted.content,
        spilled: true,
        storagePath: filepath,
        originalLength: formatted.originalLength,
        lineCount: formatted.lineCount,
        storageTruncated
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content:
          `Output too large (${lineCount} lines)\n\n` +
          `Failed to save to file: ${errorMessage}\n\n` +
          `Truncated output:\n${text.slice(0, maxDirect)}`,
        spilled: false,
        originalLength: text.length,
        lineCount,
        storageTruncated
      };
    }
  }
}
