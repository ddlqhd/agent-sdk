import { randomUUID } from 'node:crypto';
import {
  SessionManager,
  getSessionStoragePath,
  type Agent,
  type AgentForkSessionOptions,
  type ForkSessionResult,
  type Message,
  type SessionInfo
} from '@ddlqhd/agent-sdk';
import type { TurnSink } from './ports.js';
import { runTurn, type TurnResult } from './turn.js';

export interface SessionRecord<TExtra = unknown> {
  sessionId: string;
  cwd: string;
  agent: Agent;
  abortController: AbortController | null;
  extra: TExtra;
}

export interface ForkedSessionRecord<TExtra = unknown> extends SessionRecord<TExtra> {
  forkResult: ForkSessionResult;
}

export interface SessionBindContext<TExtra, TContext = unknown> {
  sessionId: string;
  cwd: string;
  extra: TExtra;
  context?: TContext;
}

export interface SessionHistoryContext<TExtra, TContext = unknown>
  extends SessionBindContext<TExtra, TContext> {
  agent: Agent;
  messages: Message[];
}

export interface SessionRuntimeHooks<TExtra = unknown, TContext = unknown> {
  resolveUserBasePath: () => string;
  storageType?: 'memory' | 'jsonl' | (() => 'memory' | 'jsonl');
  listPageSize?: number;
  createExtra: (ctx: {
    sessionId: string;
    cwd: string;
    context?: TContext;
  }) => TExtra | Promise<TExtra>;
  buildAgent: (ctx: SessionBindContext<TExtra, TContext>) => Promise<Agent>;
  onBound?: (record: SessionRecord<TExtra>, context?: TContext) => void | Promise<void>;
  onHistory?: (
    ctx: SessionHistoryContext<TExtra, TContext>
  ) => void | Promise<void>;
  onDestroyError?: (sessionId: string, error: unknown) => void;
}

export interface ListSessionsQuery {
  cwd?: string | null;
  cursor?: string | null;
}

export interface ListedSession {
  id: string;
  cwd?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ListSessionsResult {
  sessions: ListedSession[];
  nextCursor: string | null;
}

const DEFAULT_LIST_PAGE_SIZE = 50;

function resolveStorageType(
  storageType: SessionRuntimeHooks['storageType']
): 'memory' | 'jsonl' {
  if (typeof storageType === 'function') return storageType();
  return storageType ?? 'jsonl';
}

/**
 * Multi-session control kernel: one Agent per session, shared by Web and ACP.
 * CLI/TUI stay single-agent and use {@link runTurn} in-process.
 */
export class SessionRuntime<TExtra = unknown, TContext = unknown> {
  private readonly sessions = new Map<string, SessionRecord<TExtra>>();
  private readonly hooks: SessionRuntimeHooks<TExtra, TContext>;
  private readonly listPageSize: number;

  constructor(hooks: SessionRuntimeHooks<TExtra, TContext>) {
    this.hooks = hooks;
    this.listPageSize = hooks.listPageSize ?? DEFAULT_LIST_PAGE_SIZE;
  }

  get(sessionId: string): SessionRecord<TExtra> | undefined {
    return this.sessions.get(sessionId);
  }

  values(): IterableIterator<SessionRecord<TExtra>> {
    return this.sessions.values();
  }

  get activeCount(): number {
    return this.sessions.size;
  }

  async create(
    cwd: string,
    sessionId?: string,
    context?: TContext
  ): Promise<SessionRecord<TExtra>> {
    const id = sessionId ?? randomUUID();
    const extra = await this.hooks.createExtra({ sessionId: id, cwd, context });
    const agent = await this.hooks.buildAgent({ sessionId: id, cwd, extra, context });
    agent.getSessionManager().createSession(id);
    const record: SessionRecord<TExtra> = {
      sessionId: id,
      cwd,
      agent,
      abortController: null,
      extra
    };
    this.sessions.set(id, record);
    await this.hooks.onBound?.(record, context);
    return record;
  }

  async load(sessionId: string, cwd: string, context?: TContext): Promise<SessionRecord<TExtra>> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.cwd = cwd;
      return existing;
    }

    const exists = await this.sessionExists(sessionId);
    if (!exists) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const extra = await this.hooks.createExtra({ sessionId, cwd, context });
    const agent = await this.hooks.buildAgent({ sessionId, cwd, extra, context });
    await agent.getSessionManager().attachSession(sessionId);
    const messages = await agent.getSessionManager().loadActiveMessages();
    const record: SessionRecord<TExtra> = {
      sessionId,
      cwd,
      agent,
      abortController: null,
      extra
    };
    this.sessions.set(sessionId, record);
    await this.hooks.onBound?.(record, context);
    await this.hooks.onHistory?.({ sessionId, cwd, extra, context, agent, messages });
    return record;
  }

  async fork(
    sourceSessionId: string,
    options?: AgentForkSessionOptions & { cwd?: string; context?: TContext }
  ): Promise<ForkedSessionRecord<TExtra>> {
    this.cancel(sourceSessionId);
    const context = options?.context;
    const inMemory = this.sessions.get(sourceSessionId);
    let sourceAgent: Agent;
    let tempSource: Agent | null = null;
    let cwd: string;

    if (inMemory) {
      cwd = options?.cwd ?? inMemory.cwd;
      sourceAgent = inMemory.agent;
    } else {
      const exists = await this.sessionExists(sourceSessionId);
      if (!exists) {
        throw new Error(`Session not found: ${sourceSessionId}`);
      }
      const stored = await this.listStoredSessions();
      cwd = options?.cwd ?? stored.find((s) => s.id === sourceSessionId)?.cwd ?? process.cwd();
      const extra = await this.hooks.createExtra({ sessionId: sourceSessionId, cwd, context });
      tempSource = await this.hooks.buildAgent({
        sessionId: sourceSessionId,
        cwd,
        extra,
        context
      });
      await tempSource.getSessionManager().attachSession(sourceSessionId);
      sourceAgent = tempSource;
    }

    const newId = options?.newSessionId ?? randomUUID();
    try {
      const forkResult = await sourceAgent.forkSession(sourceSessionId, {
        newSessionId: newId,
        switchToForked: false,
        checkpointId: options?.checkpointId,
        userTurnIndex: options?.userTurnIndex
      });

      const extra = await this.hooks.createExtra({ sessionId: newId, cwd, context });
      const forked = await this.hooks.buildAgent({ sessionId: newId, cwd, extra, context });
      await forked.getSessionManager().attachSession(newId);
      const messages = await forked.getSessionManager().loadActiveMessages();
      const record: SessionRecord<TExtra> = {
        sessionId: newId,
        cwd,
        agent: forked,
        abortController: null,
        extra
      };
      this.sessions.set(newId, record);
      await this.hooks.onBound?.(record, context);
      await this.hooks.onHistory?.({
        sessionId: newId,
        cwd,
        extra,
        context,
        agent: forked,
        messages
      });
      return { ...record, forkResult };
    } finally {
      if (tempSource) {
        try {
          await tempSource.destroy();
        } catch (error) {
          this.hooks.onDestroyError?.(sourceSessionId, error);
        }
      }
    }
  }

  async list(query?: ListSessionsQuery): Promise<ListSessionsResult> {
    const cwdById = new Map<string, string>();
    for (const record of this.sessions.values()) {
      cwdById.set(record.sessionId, record.cwd);
    }

    const listed = await this.listStoredSessions();
    let sessions: ListedSession[] = listed.map((s) => ({
      id: s.id,
      cwd: cwdById.get(s.id) ?? s.cwd,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messageCount
    }));

    if (query?.cwd) {
      sessions = sessions.filter((s) => s.cwd === query.cwd);
    }

    const start = query?.cursor ? Number.parseInt(query.cursor, 10) || 0 : 0;
    const page = sessions.slice(start, start + this.listPageSize);
    const next =
      start + this.listPageSize < sessions.length ? String(start + this.listPageSize) : null;
    return { sessions: page, nextCursor: next };
  }

  cancel(sessionId: string): void {
    this.sessions.get(sessionId)?.abortController?.abort();
  }

  beginTurn(sessionId: string): AbortController {
    const record = this.require(sessionId);
    record.abortController?.abort();
    const ac = new AbortController();
    record.abortController = ac;
    return ac;
  }

  endTurn(sessionId: string, controller: AbortController): void {
    const record = this.sessions.get(sessionId);
    if (record && record.abortController === controller) {
      record.abortController = null;
    }
  }

  async prompt(
    sessionId: string,
    text: string,
    sink?: TurnSink,
    options?: { forkSession?: boolean; signal?: AbortSignal }
  ): Promise<TurnResult> {
    const record = this.require(sessionId);
    const ac = options?.signal ? undefined : this.beginTurn(sessionId);
    const signal = options?.signal ?? ac!.signal;
    try {
      return await runTurn({
        agent: record.agent,
        text,
        sessionId,
        signal,
        forkSession: options?.forkSession,
        sink
      });
    } finally {
      if (ac) this.endTurn(sessionId, ac);
    }
  }

  async close(sessionId: string): Promise<void> {
    this.cancel(sessionId);
    await this.destroy(sessionId);
  }

  async deleteStored(sessionId: string): Promise<void> {
    this.cancel(sessionId);
    const record = this.sessions.get(sessionId);
    if (record) {
      await record.agent.getSessionManager().deleteSession(sessionId);
      await this.destroy(sessionId);
      return;
    }
    const reference = this.sessions.values().next().value as SessionRecord<TExtra> | undefined;
    if (reference) {
      await reference.agent.getSessionManager().deleteSession(sessionId);
      return;
    }
    const probe = this.createProbeManager();
    if (probe) {
      await probe.deleteSession(sessionId);
    }
  }

  async destroy(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.abortController?.abort();
    try {
      await record.agent.destroy();
    } catch (error) {
      this.hooks.onDestroyError?.(sessionId, error);
    }
    this.sessions.delete(sessionId);
  }

  async destroyAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) {
      await this.destroy(id);
    }
  }

  private require(sessionId: string): SessionRecord<TExtra> {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return record;
  }

  private sessionStorageBase(): string {
    return getSessionStoragePath(this.hooks.resolveUserBasePath());
  }

  private createProbeManager(): SessionManager | null {
    if (resolveStorageType(this.hooks.storageType) !== 'jsonl') {
      return null;
    }
    return new SessionManager({
      type: 'jsonl',
      basePath: this.sessionStorageBase()
    });
  }

  private async sessionExists(sessionId: string): Promise<boolean> {
    if (this.sessions.has(sessionId)) return true;
    const reference = this.sessions.values().next().value as SessionRecord<TExtra> | undefined;
    if (reference) {
      return reference.agent.getSessionManager().sessionExists(sessionId);
    }
    const probe = this.createProbeManager();
    if (!probe) return false;
    return probe.sessionExists(sessionId);
  }

  async listStoredSessions(): Promise<SessionInfo[]> {
    const reference = this.sessions.values().next().value as SessionRecord<TExtra> | undefined;
    if (reference) {
      return reference.agent.getSessionManager().listSessions();
    }
    const probe = this.createProbeManager();
    if (!probe) return [];
    return probe.listSessions();
  }
}
