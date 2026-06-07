import { createHash } from 'node:crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import type {
  SessionEntry,
  SessionInfo,
  StorageAdapter,
  SummaryEntry,
  RewindEntry,
  SystemPromptSidecar
} from '../core/types.js';

/**
 * JSONL 文件存储配置
 */
export interface JsonlStorageConfig {
  basePath?: string;
}

/**
 * JSONL append-only 存储：每行一条 {@link SessionEntry}。
 * System prompt 不进 jsonl，由 {@link SessionManager.saveSystemPrompt} 写侧车文件。
 */
export class JsonlStorage implements StorageAdapter {
  private basePath: string;

  constructor(config: JsonlStorageConfig = {}) {
    this.basePath = config.basePath || './sessions';
  }

  private getFilePath(sessionId: string): string {
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.basePath, `${safeId}.jsonl`);
  }

  private getMetaFilePath(sessionId: string): string {
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.basePath, `${safeId}.meta.json`);
  }

  getBasePath(): string {
    return this.basePath;
  }

  private getSystemSidecarPath(sessionId: string): string {
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.basePath, `${safeId}.system.json`);
  }

  getSystemSidecarFilePath(sessionId: string): string {
    return this.getSystemSidecarPath(sessionId);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  private async atomicReplaceFile(targetPath: string, data: string): Promise<void> {
    const tmp = `${targetPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmp, data, 'utf-8');
    try {
      await fs.rename(tmp, targetPath);
    } catch (err) {
      if (process.platform === 'win32') {
        await fs.rm(targetPath, { force: true }).catch(() => {});
        await fs.rename(tmp, targetPath);
      } else {
        await fs.unlink(tmp).catch(() => {});
        throw err;
      }
    }
  }

  private async readMeta(sessionId: string): Promise<SessionInfo | null> {
    const metaPath = this.getMetaFilePath(sessionId);
    try {
      return JSON.parse(await fs.readFile(metaPath, 'utf-8')) as SessionInfo;
    } catch {
      return null;
    }
  }

  private async writeMetaAtomic(sessionId: string, messageCount: number): Promise<void> {
    const metaPath = this.getMetaFilePath(sessionId);
    const meta: SessionInfo = {
      id: sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount
    };

    const existing = await this.readMeta(sessionId);
    if (existing) {
      meta.createdAt = existing.createdAt;
    }

    const payload = JSON.stringify(meta, null, 2);
    await this.atomicReplaceFile(metaPath, payload);
  }

  private parseLine(line: string): SessionEntry | null {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.$type === 'summary') {
        return parsed as unknown as SummaryEntry;
      }
      if (parsed.$type === 'rewind') {
        return parsed as unknown as RewindEntry;
      }
      const { timestamp: _t, ...rest } = parsed;
      return rest as unknown as SessionEntry;
    } catch {
      return null;
    }
  }

  /**
   * 仅追加条目（不重写 jsonl）
   */
  async append(sessionId: string, entries: SessionEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.ensureDir();
    const filePath = this.getFilePath(sessionId);
    const now = Date.now();
    const lines =
      entries
        .map((e) => {
      const rec =
        (e as SummaryEntry).$type === 'summary' || (e as RewindEntry).$type === 'rewind'
          ? { ...e, timestamp: ((e as SummaryEntry | RewindEntry).timestamp ?? now) }
          : ({
              ...(e as unknown as Record<string, unknown>),
              timestamp: (e as { timestamp?: number }).timestamp ?? now
            } as Record<string, unknown>);
      return JSON.stringify(rec);
        })
        .join('\n') + '\n';

    await fs.appendFile(filePath, lines, 'utf-8');

    const existing = await this.readMeta(sessionId);
    const count = (existing?.messageCount ?? 0) + entries.length;
    await this.writeMetaAtomic(sessionId, count);
  }

  /**
   * 加载全部原始条目（含 summary 截断前的历史）
   */
  async load(sessionId: string): Promise<SessionEntry[]> {
    const filePath = this.getFilePath(sessionId);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const out: SessionEntry[] = [];
      for (const line of lines) {
        const entry = this.parseLine(line);
        if (entry) {
          out.push(entry);
        }
      }
      return out;
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * 写入 system prompt 侧车（审计）
   */
  async saveSystemPrompt(
    sessionId: string,
    content: string,
    meta: Pick<SystemPromptSidecar, 'agentName' | 'cwd'>
  ): Promise<void> {
    await this.ensureDir();
    const side: SystemPromptSidecar = {
      content,
      contentSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
      savedAt: Date.now(),
      ...meta
    };
    const path = this.getSystemSidecarPath(sessionId);
    await this.atomicReplaceFile(path, JSON.stringify(side, null, 2));
  }

  async list(): Promise<SessionInfo[]> {
    await this.ensureDir();
    try {
      const files = await fs.readdir(this.basePath);
      const metaFiles = files.filter((f) => f.endsWith('.meta.json'));
      const sessions: SessionInfo[] = [];
      for (const metaFile of metaFiles) {
        try {
          const metaPath = join(this.basePath, metaFile);
          const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as SessionInfo;
          sessions.push(meta);
        } catch {
          // skip corrupt meta
        }
      }
      return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  async delete(sessionId: string): Promise<void> {
    const filePath = this.getFilePath(sessionId);
    const metaPath = this.getMetaFilePath(sessionId);
    const sysPath = this.getSystemSidecarPath(sessionId);
    await Promise.all([
      fs.unlink(filePath).catch(() => {}),
      fs.unlink(metaPath).catch(() => {}),
      fs.unlink(sysPath).catch(() => {})
    ]);
  }

  async exists(sessionId: string): Promise<boolean> {
    const filePath = this.getFilePath(sessionId);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    await this.ensureDir();
    try {
      const files = await fs.readdir(this.basePath);
      await Promise.all(files.map((file) => fs.unlink(join(this.basePath, file)).catch(() => {})));
    } catch {
      // ignore
    }
  }

  /**
   * 会话统计
   */
  async getStats(sessionId: string): Promise<{
    messageCount: number;
    createdAt: number;
    updatedAt: number;
    size: number;
  } | null> {
    const filePath = this.getFilePath(sessionId);
    const metaPath = this.getMetaFilePath(sessionId);
    try {
      const [metaContent, fileStat] = await Promise.all([
        fs.readFile(metaPath, 'utf-8'),
        fs.stat(filePath)
      ]);
      const meta = JSON.parse(metaContent) as SessionInfo;
      return {
        messageCount: meta.messageCount,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        size: fileStat.size
      };
    } catch {
      return null;
    }
  }
}

export function createJsonlStorage(config?: JsonlStorageConfig): JsonlStorage {
  return new JsonlStorage(config);
}
