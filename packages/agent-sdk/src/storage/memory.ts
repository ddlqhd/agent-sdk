import type {
  SessionEntry,
  SessionInfo,
  StorageAdapter,
  SummaryEntry,
  RewindEntry,
  UsageEntry
} from '../core/types.js';

function preservedSessionFields(
  existing: SessionInfo | undefined
): Pick<SessionInfo, 'cwd' | 'agentName' | 'metadata'> {
  if (!existing) {
    return {};
  }
  return {
    ...(existing.cwd !== undefined ? { cwd: existing.cwd } : {}),
    ...(existing.agentName !== undefined ? { agentName: existing.agentName } : {}),
    ...(existing.metadata !== undefined ? { metadata: existing.metadata } : {})
  };
}

/**
 * 内存存储（测试 / 临时会话）；语义与 {@link JsonlStorage} 对齐：append-only + meta 中的 cwd / agentName
 */
export class MemoryStorage implements StorageAdapter {
  private sessions: Map<string, SessionEntry[]> = new Map();
  private metadata: Map<string, SessionInfo> = new Map();

  async append(sessionId: string, entries: SessionEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    const existing = this.sessions.get(sessionId) ?? [];
    const now = Date.now();
    const stamped = entries.map((e) => {
      if (
        (e as SummaryEntry).$type === 'summary' ||
        (e as RewindEntry).$type === 'rewind' ||
        (e as UsageEntry).$type === 'usage'
      ) {
        const meta = e as SummaryEntry | RewindEntry | UsageEntry;
        return { ...meta, timestamp: meta.timestamp ?? now };
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
      messageCount: (metaExisting?.messageCount ?? 0) + entries.length,
      ...preservedSessionFields(metaExisting)
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
  }

  async exists(sessionId: string): Promise<boolean> {
    return this.sessions.has(sessionId);
  }

  async updateSessionMeta(
    sessionId: string,
    patch: Pick<SessionInfo, 'cwd' | 'agentName'>
  ): Promise<void> {
    const existing = this.metadata.get(sessionId);
    const now = Date.now();
    const next: SessionInfo = existing
      ? {
          ...existing,
          updatedAt: now,
          ...(patch.cwd !== undefined ? { cwd: patch.cwd } : {}),
          ...(patch.agentName !== undefined ? { agentName: patch.agentName } : {})
        }
      : {
          id: sessionId,
          createdAt: now,
          updatedAt: now,
          messageCount: 0,
          ...(patch.cwd !== undefined ? { cwd: patch.cwd } : {}),
          ...(patch.agentName !== undefined ? { agentName: patch.agentName } : {})
        };
    this.metadata.set(sessionId, next);
  }

  clear(): Promise<void> {
    this.sessions.clear();
    this.metadata.clear();
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
}

export function createMemoryStorage(): MemoryStorage {
  return new MemoryStorage();
}
