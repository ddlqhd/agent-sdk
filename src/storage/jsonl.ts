import { promises as fs } from 'fs';
import { join } from 'path';
import type { StorageAdapter, Message, SessionInfo } from '../core/types.js';

/**
 * JSONL 文件存储配置
 */
export interface JsonlStorageConfig {
  basePath?: string;
}

/**
 * Persists only user / assistant / tool messages. System prompts are built at runtime by
 * {@link Agent.appendInitialSystemMessages} and are not written to disk.
 *
 * Save semantics: append new lines only when the new sequence is a strict extension of the
 * on-disk persistable history (same prefix). Otherwise the file is replaced atomically
 * (e.g. after context compression or in-place edits).
 */
export class JsonlStorage implements StorageAdapter {
  private basePath: string;

  constructor(config: JsonlStorageConfig = {}) {
    this.basePath = config.basePath || './sessions';
  }

  /**
   * 获取会话文件路径
   */
  private getFilePath(sessionId: string): string {
    // 确保会话 ID 安全（防止路径遍历）
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.basePath, `${safeId}.jsonl`);
  }

  /**
   * 获取元数据文件路径
   */
  private getMetaFilePath(sessionId: string): string {
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.basePath, `${safeId}.meta.json`);
  }

  /**
   * 确保目录存在
   */
  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  private filterPersistable(messages: Message[]): Message[] {
    return messages.filter((m) => m.role !== 'system');
  }

  private static sameMessageIdentity(a: Message, b: Message): boolean {
    if (a.role !== b.role) return false;
    if (a.toolCallId !== b.toolCallId) return false;
    if (JSON.stringify(a.toolCalls ?? null) !== JSON.stringify(b.toolCalls ?? null)) {
      return false;
    }
    if (typeof a.content === 'string' && typeof b.content === 'string') {
      return a.content === b.content;
    }
    if (Array.isArray(a.content) && Array.isArray(b.content)) {
      return JSON.stringify(a.content) === JSON.stringify(b.content);
    }
    return false;
  }

  /**
   * Parse JSONL on disk and return non-system messages (drops legacy persisted system lines).
   */
  private async readPersistableFromDisk(filePath: string): Promise<Message[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const out: Message[] = [];
      for (const line of lines) {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const { timestamp: _ts, ...rest } = parsed;
        const message = rest as unknown as Message;
        if (message.role === 'system') {
          continue;
        }
        out.push(message);
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

  private serializeLines(messages: Message[]): string {
    if (messages.length === 0) {
      return '';
    }
    return (
      messages
        .map((msg) => {
          const record = {
            ...msg,
            timestamp: msg.timestamp || Date.now()
          };
          return JSON.stringify(record);
        })
        .join('\n') + '\n'
    );
  }

  private isStrictExtension(existing: Message[], persistable: Message[]): boolean {
    if (persistable.length < existing.length) {
      return false;
    }
    for (let i = 0; i < existing.length; i++) {
      if (!JsonlStorage.sameMessageIdentity(existing[i]!, persistable[i]!)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Write then rename for safer updates. Windows may require removing the target first.
   */
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

  private async writeMetaAtomic(sessionId: string, messageCount: number): Promise<void> {
    const metaPath = this.getMetaFilePath(sessionId);
    const meta: SessionInfo = {
      id: sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount
    };

    try {
      const existingMeta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as SessionInfo;
      meta.createdAt = existingMeta.createdAt;
    } catch {
      // new session
    }

    const payload = JSON.stringify(meta, null, 2);
    const tmp = `${metaPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmp, payload, 'utf-8');
    try {
      await fs.rename(tmp, metaPath);
    } catch (err) {
      if (process.platform === 'win32') {
        await fs.rm(metaPath, { force: true }).catch(() => {});
        await fs.rename(tmp, metaPath);
      } else {
        await fs.unlink(tmp).catch(() => {});
        throw err;
      }
    }
  }

  /**
   * 保存消息：在可追加时仅追加新行；否则原子重写整个 JSONL。
   */
  async save(sessionId: string, messages: Message[]): Promise<void> {
    await this.ensureDir();

    const filePath = this.getFilePath(sessionId);
    const persistable = this.filterPersistable(messages);

    const existingPersistable = await this.readPersistableFromDisk(filePath);
    const canAppend =
      persistable.length >= existingPersistable.length &&
      this.isStrictExtension(existingPersistable, persistable);

    if (canAppend) {
      const newMessages = persistable.slice(existingPersistable.length);
      if (newMessages.length > 0) {
        const chunk = this.serializeLines(newMessages);
        await fs.appendFile(filePath, chunk, 'utf-8');
      }
    } else {
      await this.atomicReplaceFile(filePath, this.serializeLines(persistable));
    }

    await this.writeMetaAtomic(sessionId, persistable.length);
  }

  /**
   * 加载消息（不包含 system；兼容旧文件中首行 system）
   */
  async load(sessionId: string): Promise<Message[]> {
    const filePath = this.getFilePath(sessionId);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      return lines
        .map((line) => {
          const parsed = JSON.parse(line);
          const { timestamp, ...message } = parsed;
          return message as Message;
        })
        .filter((m) => m.role !== 'system');
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * 列出所有会话
   */
  async list(): Promise<SessionInfo[]> {
    await this.ensureDir();

    try {
      const files = await fs.readdir(this.basePath);
      const metaFiles = files.filter((f) => f.endsWith('.meta.json'));

      const sessions: SessionInfo[] = [];

      for (const metaFile of metaFiles) {
        try {
          const metaPath = join(this.basePath, metaFile);
          const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
          sessions.push(meta);
        } catch {
          // 跳过损坏的元数据文件
        }
      }

      // 按更新时间排序
      return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  /**
   * 删除会话
   */
  async delete(sessionId: string): Promise<void> {
    const filePath = this.getFilePath(sessionId);
    const metaPath = this.getMetaFilePath(sessionId);

    await Promise.all([
      fs.unlink(filePath).catch(() => {}),
      fs.unlink(metaPath).catch(() => {})
    ]);
  }

  /**
   * 检查会话是否存在
   */
  async exists(sessionId: string): Promise<boolean> {
    const filePath = this.getFilePath(sessionId);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 清空所有会话
   */
  async clear(): Promise<void> {
    await this.ensureDir();

    try {
      const files = await fs.readdir(this.basePath);
      await Promise.all(files.map((file) => fs.unlink(join(this.basePath, file)).catch(() => {})));
    } catch {
      // 目录不存在
    }
  }

  /**
   * 获取会话统计
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

      const meta = JSON.parse(metaContent);
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

/**
 * 创建 JSONL 存储
 */
export function createJsonlStorage(config?: JsonlStorageConfig): JsonlStorage {
  return new JsonlStorage(config);
}
