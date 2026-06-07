import { randomUUID } from 'node:crypto';
import { promises as fs } from 'fs';
import type {
  CompressionStats,
  ContentPart,
  ForkSessionOptions,
  ForkSessionResult,
  Message,
  RewindEntry,
  RewindSessionResult,
  RewindToCheckpointOptions,
  SessionCheckpoint,
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
import { JsonlStorage } from './jsonl.js';
import { MemoryStorage } from './memory.js';

const CHECKPOINT_ID_PREFIX = 'v1:';
const CHECKPOINT_PREVIEW_MAX = 80;

export function isSummaryEntry(e: SessionEntry): e is SummaryEntry {
  return (e as SummaryEntry).$type === 'summary';
}

export function isRewindEntry(e: SessionEntry): e is RewindEntry {
  return (e as RewindEntry).$type === 'rewind';
}

export function isPersistableMessageEntry(e: SessionEntry): e is Message & { $type?: 'message' } {
  if (isSummaryEntry(e) || isRewindEntry(e)) {
    return false;
  }
  const m = e as Message;
  return m.role !== undefined && m.role !== 'system';
}

export function isUserCheckpointEntry(e: SessionEntry): boolean {
  return isPersistableMessageEntry(e) && (e as Message).role === 'user';
}

export function encodeCheckpointId(sessionId: string, keepThroughRawIndex: number): string {
  return `${CHECKPOINT_ID_PREFIX}${sessionId}:${keepThroughRawIndex}`;
}

export function decodeCheckpointId(checkpointId: string, expectedSessionId: string): number {
  if (!checkpointId.startsWith(CHECKPOINT_ID_PREFIX)) {
    throw new Error(`Invalid checkpointId: ${checkpointId}`);
  }
  const body = checkpointId.slice(CHECKPOINT_ID_PREFIX.length);
  const colon = body.lastIndexOf(':');
  if (colon <= 0) {
    throw new Error(`Invalid checkpointId: ${checkpointId}`);
  }
  const sessionId = body.slice(0, colon);
  const index = Number.parseInt(body.slice(colon + 1), 10);
  if (sessionId !== expectedSessionId) {
    throw new Error(
      `checkpointId session mismatch: expected ${expectedSessionId}, got ${sessionId}`
    );
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid checkpointId: ${checkpointId}`);
  }
  return index;
}

function summaryToUserMessage(s: SummaryEntry): Message {
  const content =
    s.summaryMode === 'llm'
      ? formatSyntheticUserSummary(s.text)
      : formatSyntheticFallbackNotice(s.text);
  return { role: 'user', content };
}

function entryToMessage(e: SessionEntry): Message | null {
  if (isSummaryEntry(e)) {
    return summaryToUserMessage(e);
  }
  if (isRewindEntry(e)) {
    return null;
  }
  const m = e as Message;
  if (m.role === 'system') {
    return null;
  }
  const { timestamp: _ts, ...rest } = m as Message & { timestamp?: number };
  return rest as Message;
}

/**
 * Prefix walk from start through endInclusive (inclusive).
 */
export function reconstructPrefixMessages(
  entries: SessionEntry[],
  endInclusive: number
): Message[] {
  const out: Message[] = [];
  const end = Math.min(endInclusive, entries.length - 1);
  for (let i = 0; i <= end; i++) {
    const e = entries[i];
    if (isSummaryEntry(e)) {
      out.length = 0;
      out.push(summaryToUserMessage(e));
    } else if (isRewindEntry(e)) {
      continue;
    } else {
      const m = entryToMessage(e);
      if (m) {
        out.push(m);
      }
    }
  }
  return out;
}

function reconstructSegmentFromLastSummary(entries: SessionEntry[]): Message[] {
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isSummaryEntry(entries[i])) {
      start = i;
      break;
    }
  }
  const slice = entries.slice(start);
  const out: Message[] = [];
  for (const e of slice) {
    if (isSummaryEntry(e)) {
      out.length = 0;
      out.push(summaryToUserMessage(e));
    } else if (isRewindEntry(e)) {
      continue;
    } else {
      const m = entryToMessage(e);
      if (m) {
        out.push(m);
      }
    }
  }
  return out;
}

function findLastRewindIndex(entries: SessionEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isRewindEntry(entries[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * 从磁盘原始条目重建活动链（含 rewind prefix + tail 语义）。
 */
export function reconstructActiveMessages(entries: SessionEntry[]): Message[] {
  const rewindIdx = findLastRewindIndex(entries);
  if (rewindIdx < 0) {
    return reconstructSegmentFromLastSummary(entries);
  }
  const rewind = entries[rewindIdx] as RewindEntry;
  const prefix = reconstructPrefixMessages(entries, rewind.keepThroughRawIndex);
  const tailSlice = entries.slice(rewindIdx + 1);
  if (tailSlice.length === 0) {
    return prefix;
  }
  const tailActive = reconstructSegmentFromLastSummary(tailSlice);
  return [...prefix, ...tailActive];
}

function formatCheckpointPreview(content: string | ContentPart[]): string {
  if (typeof content === 'string') {
    if (content.length <= CHECKPOINT_PREVIEW_MAX) {
      return content;
    }
    return `${content.slice(0, CHECKPOINT_PREVIEW_MAX)}…`;
  }
  return '[multimodal]';
}

export function listSessionCheckpointsFromRaw(
  sessionId: string,
  entries: SessionEntry[]
): SessionCheckpoint[] {
  const checkpoints: SessionCheckpoint[] = [];
  let userTurnIndex = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!isUserCheckpointEntry(e)) {
      continue;
    }
    const m = e as Message;
    const summariesAfter = entries.filter(
      (row, idx) => idx > i && isSummaryEntry(row)
    ).length;
    const ts = (m as Message & { timestamp?: number }).timestamp;
    checkpoints.push({
      checkpointId: encodeCheckpointId(sessionId, i),
      userTurnIndex,
      preview: formatCheckpointPreview(m.content),
      ...(ts !== undefined ? { timestamp: ts } : {}),
      ...(summariesAfter > 0 ? { summariesAfter } : {})
    });
    userTurnIndex++;
  }
  return checkpoints;
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

export function buildRewindEntry(
  keepThroughRawIndex: number,
  timestamp: number = Date.now()
): RewindEntry {
  return {
    $type: 'rewind',
    keepThroughRawIndex,
    timestamp
  };
}

function resolveForkThroughRawIndex(
  entries: SessionEntry[],
  sessionId: string,
  options: ForkSessionOptions
): number | undefined {
  if (options.throughRawIndex !== undefined) {
    return options.throughRawIndex;
  }
  if (options.checkpointId !== undefined) {
    return decodeCheckpointId(options.checkpointId, sessionId);
  }
  if (options.userTurnIndex !== undefined) {
    return resolveUserTurnIndexToRaw(entries, options.userTurnIndex);
  }
  return undefined;
}

function resolveUserTurnIndexToRaw(entries: SessionEntry[], userTurnIndex: number): number {
  let count = 0;
  for (let i = 0; i < entries.length; i++) {
    if (isUserCheckpointEntry(entries[i])) {
      if (count === userTurnIndex) {
        return i;
      }
      count++;
    }
  }
  throw new Error(`userTurnIndex ${userTurnIndex} not found in session transcript`);
}

function resolveRewindKeepThroughRawIndex(
  entries: SessionEntry[],
  sessionId: string,
  options: RewindToCheckpointOptions
): number {
  if (options.keepThroughRawIndex !== undefined) {
    return options.keepThroughRawIndex;
  }
  if (options.checkpointId !== undefined) {
    return decodeCheckpointId(options.checkpointId, sessionId);
  }
  if (options.userTurnIndex !== undefined) {
    return resolveUserTurnIndexToRaw(entries, options.userTurnIndex);
  }
  throw new Error(
    'rewindToCheckpoint requires checkpointId, userTurnIndex, or keepThroughRawIndex'
  );
}

function assertUserCheckpointRawIndex(entries: SessionEntry[], rawIndex: number): void {
  if (rawIndex < 0 || rawIndex >= entries.length) {
    throw new Error(`Invalid raw index ${rawIndex} for session transcript`);
  }
  if (!isUserCheckpointEntry(entries[rawIndex])) {
    throw new Error(`Raw index ${rawIndex} is not a user message checkpoint`);
  }
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

  async listSessionCheckpoints(): Promise<SessionCheckpoint[]> {
    if (!this.currentSessionId) {
      throw new Error('No session attached');
    }
    const entries = await this.loadRawEntries();
    return listSessionCheckpointsFromRaw(this.currentSessionId, entries);
  }

  async rewindSession(keepThroughRawIndex: number): Promise<RewindSessionResult> {
    if (!this.currentSessionId) {
      throw new Error('No session attached');
    }
    const entries = await this.loadRawEntries();
    assertUserCheckpointRawIndex(entries, keepThroughRawIndex);
    const before = reconstructActiveMessages(entries).length;
    const rewindEntry = buildRewindEntry(keepThroughRawIndex);
    await this.appendEntries([rewindEntry]);
    const after = reconstructActiveMessages([...entries, rewindEntry]).length;
    return {
      keepThroughRawIndex,
      keptMessageCount: after,
      droppedMessageCount: before - after
    };
  }

  async rewindToCheckpoint(options: RewindToCheckpointOptions): Promise<RewindSessionResult> {
    if (!this.currentSessionId) {
      throw new Error('No session attached');
    }
    const entries = await this.loadRawEntries();
    const keepThroughRawIndex = resolveRewindKeepThroughRawIndex(
      entries,
      this.currentSessionId,
      options
    );
    return this.rewindSession(keepThroughRawIndex);
  }

  async forkSession(
    sourceSessionId: string,
    options: ForkSessionOptions = {}
  ): Promise<ForkSessionResult> {
    const exists = await this.storage.exists(sourceSessionId);
    if (!exists) {
      throw new Error(`session.fork: Session not found: ${sourceSessionId}`);
    }
    const newId = options.newSessionId ?? randomUUID();
    if (options.newSessionId !== undefined && (await this.storage.exists(newId))) {
      throw new Error(`session.fork: Session already exists: ${newId}`);
    }
    const entries = await this.storage.load(sourceSessionId);
    const throughRawIndex = resolveForkThroughRawIndex(entries, sourceSessionId, options);
    let messages: Message[];
    if (throughRawIndex !== undefined) {
      assertUserCheckpointRawIndex(entries, throughRawIndex);
      messages = reconstructPrefixMessages(entries, throughRawIndex);
    } else {
      messages = reconstructActiveMessages(entries);
    }
    const messageEntries = messages.map((m) => messageToSessionEntry(m));
    await this.storage.append(newId, messageEntries);
    await this.copySystemSidecarIfPresent(sourceSessionId, newId);
    return {
      sessionId: newId,
      sourceSessionId,
      messageCount: messages.length
    };
  }

  private async copySystemSidecarIfPresent(fromId: string, toId: string): Promise<void> {
    if (!this.storage.saveSystemPrompt) {
      return;
    }
    if (this.storage instanceof MemoryStorage) {
      const side = this.storage.getSystemPromptSidecar(fromId);
      if (side) {
        await this.storage.saveSystemPrompt(toId, side.content, {
          agentName: side.agentName,
          cwd: side.cwd
        });
      }
      return;
    }
    if (this.storage instanceof JsonlStorage) {
      const sysPath = this.storage.getSystemSidecarFilePath(fromId);
      try {
        const raw = await fs.readFile(sysPath, 'utf-8');
        const side = JSON.parse(raw) as SystemPromptSidecar;
        await this.storage.saveSystemPrompt(toId, side.content, {
          agentName: side.agentName,
          cwd: side.cwd
        });
      } catch {
        // no sidecar
      }
    }
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
