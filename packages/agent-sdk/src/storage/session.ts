import { randomUUID } from 'node:crypto';
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
  SessionTokenUsage,
  SessionUsageSummary,
  StorageAdapter,
  StorageConfig,
  SummaryEntry,
  TurnStats,
  UsageEntry
} from '../core/types.js';
import {
  formatSyntheticFallbackNotice,
  formatSyntheticUserSummary,
  parseCompactionSyntheticUser
} from '../core/compressor.js';
import { createStorage } from './interface.js';

const CHECKPOINT_ID_PREFIX = 'v1:';
const CHECKPOINT_PREVIEW_MAX = 80;

export function isSummaryEntry(e: SessionEntry): e is SummaryEntry {
  return (e as SummaryEntry).$type === 'summary';
}

export function isRewindEntry(e: SessionEntry): e is RewindEntry {
  return (e as RewindEntry).$type === 'rewind';
}

export function isUsageEntry(e: SessionEntry): e is UsageEntry {
  return (e as UsageEntry).$type === 'usage';
}

export function isPersistableMessageEntry(e: SessionEntry): e is Message & { $type?: 'message' } {
  if (isSummaryEntry(e) || isRewindEntry(e) || isUsageEntry(e)) {
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
  if (isRewindEntry(e) || isUsageEntry(e)) {
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

/**
 * 会话文件中的 usage 行。
 *
 * 不传 `throughRawIndex` 时返回全部 usage 行。token 已经花掉，
 * 因此不随 rewind 丢弃；整段 fork 时整体拷贝到新会话。
 *
 * 传入检查点的原始下标时，只保留该下标及之前的 usage 行，
 * 让按检查点分叉的累计用量和拷走的消息前缀一致。
 */
export function reconstructSessionUsageRows(
  entries: SessionEntry[],
  throughRawIndex?: number
): UsageEntry[] {
  if (throughRawIndex === undefined) {
    return entries.filter(isUsageEntry);
  }
  const end = Math.min(throughRawIndex, entries.length - 1);
  const rows: UsageEntry[] = [];
  for (let i = 0; i <= end; i++) {
    const entry = entries[i];
    if (entry && isUsageEntry(entry)) {
      rows.push(entry);
    }
  }
  return rows;
}

/** 累计一组 usage 行 */
export function summarizeUsageRows(rows: UsageEntry[]): SessionUsageSummary {
  const usage: SessionTokenUsage = {
    contextTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0
  };
  let generationMs = 0;
  let durationMs = 0;
  for (const row of rows) {
    const delta = row.usage ?? {};
    usage.inputTokens += delta.inputTokens ?? 0;
    usage.outputTokens += delta.outputTokens ?? 0;
    usage.cacheReadTokens += delta.cacheReadTokens ?? 0;
    usage.cacheWriteTokens += delta.cacheWriteTokens ?? 0;
    generationMs += row.generationMs ?? 0;
    durationMs += row.durationMs ?? 0;
  }
  usage.totalTokens = usage.inputTokens + usage.outputTokens;
  return { usage, turns: rows.length, generationMs, durationMs };
}

/** 从磁盘原始条目重算会话累计用量（resume / rewind / fork 后调用） */
export function reconstructSessionUsage(entries: SessionEntry[]): SessionUsageSummary {
  return summarizeUsageRows(reconstructSessionUsageRows(entries));
}

export function buildUsageEntry(
  stats: Pick<TurnStats, 'usage' | 'durationMs' | 'generationMs'>,
  timestamp: number = Date.now()
): UsageEntry {
  return {
    $type: 'usage',
    usage: { ...stats.usage },
    durationMs: stats.durationMs,
    generationMs: stats.generationMs,
    timestamp
  };
}

function formatCheckpointPreview(content: string | ContentPart[]): string {
  if (typeof content === 'string') {
    if (content.length <= CHECKPOINT_PREVIEW_MAX) {
      return content;
    }
    return `${content.slice(0, CHECKPOINT_PREVIEW_MAX)}…`;
  }
  // 提取文本部分和图像信息
  const texts: string[] = [];
  let imageCount = 0;
  for (const part of content) {
    if (part.type === 'text') {
      texts.push(part.text);
    } else if (part.type === 'image') {
      imageCount++;
    }
  }
  const textPreview = texts.join(' ').slice(0, CHECKPOINT_PREVIEW_MAX);
  if (imageCount > 0) {
    return textPreview ? `${textPreview} [${imageCount} image(s)]` : `[${imageCount} image(s)]`;
  }
  return textPreview || '[multimodal]';
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

  /**
   * 活动链消息 + 累计用量（一次 raw 读取，供 resume / rewind 复用）
   */
  async loadActiveSessionState(): Promise<{ messages: Message[]; usage: SessionUsageSummary }> {
    const raw = await this.loadRawEntries();
    return {
      messages: reconstructActiveMessages(raw),
      usage: reconstructSessionUsage(raw)
    };
  }

  /**
   * 追加单轮 usage 行（turn 结束时由 Agent 调用）
   */
  async appendUsageEntry(
    stats: Pick<TurnStats, 'usage' | 'durationMs' | 'generationMs'>,
    timestamp?: number
  ): Promise<void> {
    await this.appendEntries([buildUsageEntry(stats, timestamp)]);
  }

  /**
   * 重算会话累计用量（usage 行不随 rewind 丢弃）；用于 resume / rewind / fork 后恢复
   */
  async loadSessionUsage(): Promise<SessionUsageSummary> {
    const raw = await this.loadRawEntries();
    return reconstructSessionUsage(raw);
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
    // Full fork copies every usage row (spent tokens survive rewind).
    // A checkpoint fork only copies usage rows at or before that raw index.
    const usageRows = reconstructSessionUsageRows(entries, throughRawIndex);
    await this.storage.append(newId, [...messageEntries, ...usageRows]);
    await this.copySessionMetaIfPresent(sourceSessionId, newId);
    return {
      sessionId: newId,
      sourceSessionId,
      messageCount: messages.length
    };
  }

  private async copySessionMetaIfPresent(fromId: string, toId: string): Promise<void> {
    const source = await this.getSessionInfo(fromId);
    if (!source || (source.cwd === undefined && source.agentName === undefined)) {
      return;
    }
    await this.storage.updateSessionMeta(toId, {
      cwd: source.cwd,
      agentName: source.agentName
    });
  }

  async updateSessionMeta(patch: Pick<SessionInfo, 'cwd' | 'agentName'>): Promise<void> {
    if (!this.currentSessionId) {
      this.createSession();
    }
    await this.storage.updateSessionMeta(this.currentSessionId!, patch);
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
