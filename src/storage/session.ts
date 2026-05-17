import { randomUUID } from 'node:crypto';
import type {
  CompressionStats,
  Message,
  SessionEntry,
  SessionInfo,
  StorageAdapter,
  StorageConfig,
  SummaryEntry,
  SystemPromptSidecar
} from '../core/types.js';
import {
  formatSyntheticFallbackNotice,
  formatSyntheticUserSummary,
  parseCompactionSyntheticUser
} from '../core/compressor.js';
import { createStorage } from './interface.js';

/**
 * 从磁盘原始条目重建「活动链」：自最后一个 {@link SummaryEntry} 起（含），之前忽略。
 */
export function reconstructActiveMessages(entries: SessionEntry[]): Message[] {
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if ((entries[i] as SummaryEntry).$type === 'summary') {
      start = i;
      break;
    }
  }
  const slice = entries.slice(start);
  const out: Message[] = [];
  for (const e of slice) {
    if ((e as SummaryEntry).$type === 'summary') {
      const s = e as SummaryEntry;
      const content =
        s.summaryMode === 'llm'
          ? formatSyntheticUserSummary(s.text)
          : formatSyntheticFallbackNotice(s.text);
      out.push({ role: 'user', content });
    } else {
      const m = e as Message;
      if (m.role === 'system') {
        continue;
      }
      const { timestamp: _ts, ...rest } = m as Message & { timestamp?: number };
      out.push(rest as Message);
    }
  }
  return out;
}

/** 将 {@link Message} 转为可写入 JSONL 的条目（不写 system） */
export function messageToSessionEntry(message: Message): SessionEntry {
  if (message.role === 'system') {
    throw new Error('System messages must not be persisted to session storage');
  }
  const { timestamp: _t, ...rest } = message as Message & { timestamp?: number };
  return rest as SessionEntry;
}

export function buildSummaryEntry(
  firstNonSystemAfterCompaction: Message,
  stats: CompressionStats,
  timestamp: number = Date.now()
): SummaryEntry {
  const parsed = parseCompactionSyntheticUser(firstNonSystemAfterCompaction);
  if (!parsed) {
    throw new Error('Compaction summary message did not match expected synthetic user shape');
  }
  return {
    $type: 'summary',
    summaryMode: parsed.summaryMode,
    text: parsed.text,
    stats,
    timestamp
  };
}

/**
 * 会话管理器配置
 */
export interface SessionManagerConfig extends StorageConfig {
  basePath?: string;
}

/**
 * 会话管理器
 */
export class SessionManager {
  private storage: StorageAdapter;
  private currentSessionId: string | null = null;

  constructor(config?: SessionManagerConfig) {
    this.storage = createStorage(config);
  }

  get sessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 创建新会话并设为当前
   */
  createSession(sessionId?: string): string {
    this.currentSessionId = sessionId || randomUUID();
    return this.currentSessionId;
  }

  /**
   * 绑定已存在的会话（jsonl 必须存在）
   */
  async attachSession(sessionId: string): Promise<void> {
    const exists = await this.storage.exists(sessionId);
    if (!exists) {
      throw new Error(`Session "${sessionId}" not found`);
    }
    this.currentSessionId = sessionId;
  }

  /**
   * 追加条目到当前会话
   */
  async appendEntries(entries: SessionEntry[]): Promise<void> {
    if (!this.currentSessionId) {
      this.createSession();
    }
    await this.storage.append(this.currentSessionId!, entries);
  }

  /**
   * 压缩边界：追加 summary 行 + 保留的最近消息（append-only）
   */
  async appendCompactionBoundary(summary: SummaryEntry, recent: Message[]): Promise<void> {
    const recentEntries = recent.map((m) => messageToSessionEntry(m));
    await this.appendEntries([summary, ...recentEntries]);
  }

  /** 原始条目（全量，含截断前历史） */
  async loadRawEntries(): Promise<SessionEntry[]> {
    if (!this.currentSessionId) {
      return [];
    }
    return this.storage.load(this.currentSessionId);
  }

  /**
   * 活动链消息（无 system）；用于 resume
   */
  async loadActiveMessages(): Promise<Message[]> {
    const raw = await this.loadRawEntries();
    return reconstructActiveMessages(raw);
  }

  async saveSystemPrompt(
    content: string,
    meta: Pick<SystemPromptSidecar, 'agentName' | 'cwd'>
  ): Promise<void> {
    if (!this.currentSessionId) {
      this.createSession();
    }
    await this.storage.saveSystemPrompt?.(this.currentSessionId!, content, meta);
  }

  /**
   * 列出所有会话
   */
  async listSessions(): Promise<SessionInfo[]> {
    return this.storage.list();
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.storage.delete(sessionId);
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
    }
  }

  /**
   * 检查会话是否存在
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    return this.storage.exists(sessionId);
  }

  /**
   * 获取会话信息
   */
  async getSessionInfo(sessionId: string): Promise<SessionInfo | null> {
    const sessions = await this.storage.list();
    return sessions.find((s) => s.id === sessionId) || null;
  }

  /**
   * 清空当前会话（删除磁盘文件）
   */
  async clearCurrentSession(): Promise<void> {
    if (this.currentSessionId) {
      await this.storage.delete(this.currentSessionId);
      this.currentSessionId = null;
    }
  }

  getStorage(): StorageAdapter {
    return this.storage;
  }
}

export function createSessionManager(config?: StorageConfig): SessionManager {
  return new SessionManager(config);
}
