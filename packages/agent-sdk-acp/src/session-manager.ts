import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SessionManager,
  getSessionStoragePath,
  type Agent,
  type SessionEntry,
  type SessionInfo
} from '@ddlqhd/agent-sdk';
import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import type * as acp from '@agentclientprotocol/sdk';
import { buildSessionAgent } from './agent-factory.js';
import { EventBridge } from './event-bridge.js';
import { replaySessionHistory } from './history-replay.js';
import { mapEditModeId, type EditApprovalMode } from './edit-approval.js';
import { mapAcpMcpServers } from './mcp-map.js';
import { createPermissionContext, type PermissionContext } from './permissions.js';
import { logError } from './logging.js';
import { resolveAcpUserBase } from './user-base.js';

const LIST_PAGE_SIZE = 50;

export interface AcpSessionState {
  sessionId: string;
  cwd: string;
  agent: Agent;
  eventBridge: EventBridge;
  editMode: EditApprovalMode;
  permissionCtx: PermissionContext;
  abortController: AbortController | null;
}

interface CreateSessionOptions {
  editMode?: EditApprovalMode;
  mcpServers?: acp.McpServer[];
}

export class AcpSessionManager {
  private readonly sessions = new Map<string, AcpSessionState>();
  private readonly connection: AgentSideConnection;

  constructor(connection: AgentSideConnection) {
    this.connection = connection;
  }

  get(sessionId: string): AcpSessionState | undefined {
    return this.sessions.get(sessionId);
  }

  async createSession(
    cwd: string,
    sessionId?: string,
    options?: CreateSessionOptions
  ): Promise<AcpSessionState> {
    const id = sessionId ?? randomUUID();
    const editMode = options?.editMode ?? 'default';
    const eventBridge = new EventBridge(this.connection, id);
    const permissionCtx = createPermissionContext(id, cwd, editMode, this.connection);
    const userBasePath = resolveAcpUserBase();

    const agent = await buildSessionAgent({
      cwd,
      sessionId: id,
      permissionCtx,
      eventBridge,
      userBasePath,
      mcpServers: mapAcpMcpServers(options?.mcpServers)
    });
    agent.getSessionManager().createSession(id);

    const state: AcpSessionState = {
      sessionId: id,
      cwd,
      agent,
      eventBridge,
      editMode,
      permissionCtx,
      abortController: null
    };
    this.sessions.set(id, state);
    return state;
  }

  async loadSession(
    sessionId: string,
    cwd: string,
    mcpServers?: acp.McpServer[]
  ): Promise<AcpSessionState> {
    const sm = this.sessions.get(sessionId);
    if (sm) {
      sm.cwd = cwd;
      return sm;
    }

    const exists = await this.probeSessionExists(sessionId);
    if (!exists) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const eventBridge = new EventBridge(this.connection, sessionId);
    const permissionCtx = createPermissionContext(sessionId, cwd, 'default', this.connection);
    const userBasePath = resolveAcpUserBase();

    const agent = await buildSessionAgent({
      cwd,
      sessionId,
      permissionCtx,
      eventBridge,
      userBasePath,
      mcpServers: mapAcpMcpServers(mcpServers)
    });

    const manager = agent.getSessionManager();
    await manager.attachSession(sessionId);
    const messages = await manager.loadActiveMessages();
    await replaySessionHistory(this.connection, sessionId, messages);

    const state: AcpSessionState = {
      sessionId,
      cwd,
      agent,
      eventBridge,
      editMode: 'default',
      permissionCtx,
      abortController: null
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  private sessionStorageBase(): string {
    return getSessionStoragePath(resolveAcpUserBase());
  }

  private async probeSessionExists(sessionId: string): Promise<boolean> {
    const mgr = new SessionManager({
      type: 'jsonl',
      basePath: this.sessionStorageBase()
    });
    return mgr.sessionExists(sessionId);
  }

  async forkSession(sourceSessionId: string, mcpServers?: acp.McpServer[]): Promise<AcpSessionState> {
    const inMemory = this.sessions.get(sourceSessionId);
    let cwd: string;
    let editMode: EditApprovalMode = 'default';
    let entries: SessionEntry[];

    if (inMemory) {
      cwd = inMemory.cwd;
      editMode = inMemory.editMode;
      entries = await inMemory.agent.getSessionManager().getStorage().load(sourceSessionId);
    } else {
      const exists = await this.probeSessionExists(sourceSessionId);
      if (!exists) {
        throw new Error(`Session not found: ${sourceSessionId}`);
      }
      const storage = new SessionManager({
        type: 'jsonl',
        basePath: this.sessionStorageBase()
      }).getStorage();
      entries = await storage.load(sourceSessionId);
      cwd = (await this.readSessionCwdFromSidecar(sourceSessionId)) ?? process.cwd();
    }

    const newId = randomUUID();
    const forked = await this.createSession(cwd, newId, {
      editMode,
      mcpServers
    });
    if (entries.length > 0) {
      await forked.agent.getSessionManager().appendEntries(entries);
    }
    return forked;
  }

  async listSessions(cwd?: string | null, cursor?: string | null): Promise<acp.ListSessionsResponse> {
    const cwdById = new Map<string, string>();
    for (const state of this.sessions.values()) {
      cwdById.set(state.sessionId, state.cwd);
    }

    const listed = await this.listStoredSessions();
    const all: acp.SessionInfo[] = [];

    for (const s of listed) {
      const sessionCwd =
        cwdById.get(s.id) ??
        (await this.readSessionCwdFromSidecar(s.id)) ??
        cwd ??
        undefined;
      all.push({
        sessionId: s.id,
        cwd: sessionCwd ?? '',
        title: `Session ${s.id.slice(0, 8)}`,
        updatedAt: new Date(s.updatedAt).toISOString()
      });
    }

    let filtered = all;
    if (cwd) {
      filtered = all.filter((s) => s.cwd === cwd);
    }

    const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const page = filtered.slice(start, start + LIST_PAGE_SIZE);
    const next = start + LIST_PAGE_SIZE < filtered.length ? String(start + LIST_PAGE_SIZE) : undefined;
    return { sessions: page, nextCursor: next ?? null };
  }

  private async listStoredSessions(): Promise<SessionInfo[]> {
    const reference = this.sessions.values().next().value;
    if (reference) {
      return reference.agent.getSessionManager().listSessions();
    }
    const mgr = new SessionManager({
      type: 'jsonl',
      basePath: this.sessionStorageBase()
    });
    return mgr.listSessions();
  }

  private async readSessionCwdFromSidecar(sessionId: string): Promise<string | undefined> {
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sidecarPath = join(this.sessionStorageBase(), `${safeId}.system.json`);
    try {
      const raw = await readFile(sidecarPath, 'utf-8');
      const side = JSON.parse(raw) as { cwd?: string };
      return typeof side.cwd === 'string' && side.cwd.trim() ? side.cwd : undefined;
    } catch {
      return undefined;
    }
  }

  setEditMode(sessionId: string, modeId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const mode = mapEditModeId(modeId);
    state.editMode = mode;
    state.permissionCtx.editMode = mode;
  }

  cancelPrompt(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    state?.abortController?.abort();
  }

  async closeSession(sessionId: string): Promise<void> {
    this.cancelPrompt(sessionId);
    await this.destroySession(sessionId);
  }

  async destroySession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.abortController?.abort();
    try {
      await state.agent.destroy();
    } catch (e) {
      logError(`destroy session ${sessionId}`, e);
    }
    this.sessions.delete(sessionId);
  }

  async destroyAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) {
      await this.destroySession(id);
    }
  }
}
