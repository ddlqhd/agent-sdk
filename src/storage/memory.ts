import { createHash } from 'node:crypto';
import type {
  SessionEntry,
  SessionInfo,
  StorageAdapter,
  SummaryEntry,
  SystemPromptSidecar
} from '../core/types.js';

/**
 * 内存存储（测试 / 临时会话）；语义与 {@link JsonlStorage} 对齐：append-only + 侧车 system
 */
export class MemoryStorage implements StorageAdapter {
  private sessions: Map<string, SessionEntry[]> = new Map();
  private metadata: Map<string, SessionInfo> = new Map();
  private systemSidecars: Map<string, SystemPromptSidecar> = new Map();

  async append(sessionId: string, entries: SessionEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    const existing = this.sessions.get(sessionId) ?? [];
    const now = Date.now();
    const stamped = entries.map((e) => {
      if ((e as SummaryEntry).$type === 'summary') {
        const s = e as SummaryEntry;
        return { ...s, timestamp: s.timestamp ?? now };
      }
      return {
        ...(e as object),
        timestamp: (e as { timestamp?: number }).timestamp ?? now
      } as SessionEntry;
    });
    this.sessions.set(sessionId, [...existing, ...stamped]);

    const metaExisting = this.metadata.get(sessionId);
    const nowMeta = Date.now();
    this.metadata.set(sessionId, {
      id: sessionId,
      createdAt: metaExisting?.createdAt ?? nowMeta,
      updatedAt: nowMeta,
      messageCount: (metaExisting?.messageCount ?? 0) + entries.length
    });
  }

  async load(sessionId: string): Promise<SessionEntry[]> {
    const rows = this.sessions.get(sessionId);
    return rows ? [...rows] : [];
  }

  async list(): Promise<SessionInfo[]> {
    return Array.from(this.metadata.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.metadata.delete(sessionId);
    this.systemSidecars.delete(sessionId);
  }

  async exists(sessionId: string): Promise<boolean> {
    return this.sessions.has(sessionId);
  }

  async saveSystemPrompt(
    sessionId: string,
    content: string,
    meta: Pick<SystemPromptSidecar, 'agentName' | 'cwd'>
  ): Promise<void> {
    const side: SystemPromptSidecar = {
      content,
      contentSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
      savedAt: Date.now(),
      ...meta
    };
    this.systemSidecars.set(sessionId, side);
  }

  clear(): Promise<void> {
    this.sessions.clear();
    this.metadata.clear();
    this.systemSidecars.clear();
    return Promise.resolve();
  }

  get size(): number {
    return this.sessions.size;
  }

  export(): Record<string, SessionEntry[]> {
    const result: Record<string, SessionEntry[]> = {};
    for (const [key, value] of this.sessions) {
      result[key] = [...value];
    }
    return result;
  }

  import(data: Record<string, SessionEntry[]>): void {
    for (const [sessionId, entries] of Object.entries(data)) {
      this.sessions.set(sessionId, [...entries]);
      this.metadata.set(sessionId, {
        id: sessionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: entries.length
      });
    }
  }

  getSystemPromptSidecar(sessionId: string): SystemPromptSidecar | undefined {
    return this.systemSidecars.get(sessionId);
  }
}

export function createMemoryStorage(): MemoryStorage {
  return new MemoryStorage();
}
