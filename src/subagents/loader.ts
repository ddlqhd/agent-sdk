import { promises as fs } from 'fs';
import { isAbsolute, join, resolve } from 'path';
import type { SubagentProfile } from './types.js';
import type { SDKLogSink } from '../core/types.js';
import { emitSDKLog } from '../core/logger.js';
import { metadataToSubagentProfile, parseSubagentMd } from './parser.js';

export interface SubagentLoaderConfig {
  cwd?: string;
  /** When set, overrides the default SDK log emission on per-file load failures in directories. */
  onLoadFileError?: (path: string, error: unknown) => void;
  /** SDK log sink; controls where load-error warnings are routed when `onLoadFileError` is not set. */
  sdkLog?: SDKLogSink;
}

export class SubagentLoader {
  private config: SubagentLoaderConfig;

  constructor(config: SubagentLoaderConfig = {}) {
    this.config = { cwd: process.cwd(), ...config };
  }

  async loadFile(filePath: string): Promise<SubagentProfile> {
    const resolvedPath = isAbsolute(filePath)
      ? filePath
      : resolve(this.config.cwd ?? process.cwd(), filePath);
    const raw = await fs.readFile(resolvedPath, 'utf-8');
    const { metadata, content } = parseSubagentMd(raw);
    return metadataToSubagentProfile(metadata, content, resolvedPath);
  }

  /**
   * Load every `*.md` in a directory (non-recursive).
   */
  async loadAllFromDir(dirPath: string): Promise<SubagentProfile[]> {
    const resolvedPath = isAbsolute(dirPath)
      ? dirPath
      : resolve(this.config.cwd ?? process.cwd(), dirPath);
    const out: SubagentProfile[] = [];

    try {
      const entries = (await fs.readdir(resolvedPath, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      const reportLoadError = this.config.onLoadFileError;
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) {
          continue;
        }
        const full = join(resolvedPath, entry.name);
        try {
          out.push(await this.loadFile(full));
        } catch (err) {
          if (reportLoadError) {
            reportLoadError(full, err);
          } else {
            const error = err instanceof Error ? err : new Error(String(err));
            emitSDKLog({
              logger: this.config.sdkLog?.logger,
              logLevel: this.config.sdkLog?.logLevel,
              redaction: this.config.sdkLog?.redaction,
              level: 'warn',
              event: {
                component: 'agent',
                event: 'subagent.profile.load.error',
                message: 'Failed to load subagent profile file',
                cwd: this.config.cwd ?? process.cwd(),
                errorName: error.name,
                errorMessage: error.message,
                metadata: { path: full }
              }
            });
          }
        }
      }
    } catch {
      // missing dir
    }

    return out;
  }
}

export function createSubagentLoader(config?: SubagentLoaderConfig): SubagentLoader {
  return new SubagentLoader(config);
}
