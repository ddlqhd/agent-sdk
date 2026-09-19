import type { Agent } from '@ddlqhd/agent-sdk';
import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import type * as acp from '@agentclientprotocol/sdk';
import {
  SessionRuntime,
  runTurn,
  type SessionRecord,
  type TurnResult
} from '@ddlqhd/agent-sdk-control';
import { buildSessionAgent } from './agent-factory.js';
import { EventBridge } from './event-bridge.js';
import { replaySessionHistory } from './history-replay.js';
import { mapEditModeId, type EditApprovalMode } from './edit-approval.js';
import { mapAcpMcpServers } from './mcp-map.js';
import { createPermissionContext, type PermissionContext } from './permissions.js';
import { logError } from './logging.js';
import { resolveAcpUserBase } from './user-base.js';

export interface AcpSessionExtra {
  eventBridge: EventBridge;
  editMode: EditApprovalMode;
  permissionCtx: PermissionContext;
}

export interface AcpSessionContext {
  editMode?: EditApprovalMode;
  mcpServers?: acp.McpServer[];
}

export interface AcpSessionState {
  sessionId: string;
  cwd: string;
  agent: Agent;
  eventBridge: EventBridge;
  editMode: EditApprovalMode;
  permissionCtx: PermissionContext;
  abortController: AbortController | null;
}

function toState(record: SessionRecord<AcpSessionExtra>): AcpSessionState {
  return {
    sessionId: record.sessionId,
    cwd: record.cwd,
    agent: record.agent,
    eventBridge: record.extra.eventBridge,
    editMode: record.extra.editMode,
    permissionCtx: record.extra.permissionCtx,
    get abortController() {
      return record.abortController;
    },
    set abortController(value) {
      record.abortController = value;
    }
  };
}

export class AcpSessionManager {
  private readonly runtime: SessionRuntime<AcpSessionExtra, AcpSessionContext>;

  constructor(connection: AgentSideConnection) {
    this.runtime = new SessionRuntime<AcpSessionExtra, AcpSessionContext>({
      resolveUserBasePath: resolveAcpUserBase,
      storageType: 'jsonl',
      createExtra: ({ sessionId, cwd, context }) => {
        const editMode = context?.editMode ?? 'default';
        return {
          eventBridge: new EventBridge(connection, sessionId),
          editMode,
          permissionCtx: createPermissionContext(sessionId, cwd, editMode, connection)
        };
      },
      buildAgent: async ({ sessionId, cwd, extra, context }) =>
        buildSessionAgent({
          cwd,
          sessionId,
          permissionCtx: extra.permissionCtx,
          eventBridge: extra.eventBridge,
          userBasePath: resolveAcpUserBase(),
          mcpServers: mapAcpMcpServers(context?.mcpServers)
        }),
      onBound: (record) => {
        record.extra.eventBridge.setSessionUsageProvider(() => record.agent.getSessionUsage());
      },
      onHistory: async ({ sessionId, messages }) => {
        await replaySessionHistory(connection, sessionId, messages);
      },
      onDestroyError: (sessionId, error) => {
        logError(`destroy session ${sessionId}`, error);
      }
    });
  }

  get(sessionId: string): AcpSessionState | undefined {
    const record = this.runtime.get(sessionId);
    return record ? toState(record) : undefined;
  }

  async createSession(
    cwd: string,
    sessionId?: string,
    options?: AcpSessionContext
  ): Promise<AcpSessionState> {
    const record = await this.runtime.create(cwd, sessionId, options);
    return toState(record);
  }

  async loadSession(
    sessionId: string,
    cwd: string,
    mcpServers?: acp.McpServer[]
  ): Promise<AcpSessionState> {
    const record = await this.runtime.load(sessionId, cwd, { mcpServers });
    return toState(record);
  }

  async forkSession(sourceSessionId: string, mcpServers?: acp.McpServer[]): Promise<AcpSessionState> {
    const source = this.runtime.get(sourceSessionId);
    const record = await this.runtime.fork(sourceSessionId, {
      context: {
        editMode: source?.extra.editMode,
        mcpServers
      }
    });
    return toState(record);
  }

  async listSessions(cwd?: string | null, cursor?: string | null): Promise<acp.ListSessionsResponse> {
    const listed = await this.runtime.list({ cwd, cursor });
    return {
      sessions: listed.sessions.map((s) => ({
        sessionId: s.id,
        cwd: s.cwd ?? '',
        title: `Session ${s.id.slice(0, 8)}`,
        updatedAt: new Date(s.updatedAt).toISOString()
      })),
      nextCursor: listed.nextCursor
    };
  }

  setEditMode(sessionId: string, modeId: string): void {
    const record = this.runtime.get(sessionId);
    if (!record) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const mode = mapEditModeId(modeId);
    record.extra.editMode = mode;
    record.extra.permissionCtx.editMode = mode;
  }

  cancelPrompt(sessionId: string): void {
    this.runtime.cancel(sessionId);
  }

  async prompt(sessionId: string, text: string): Promise<TurnResult> {
    const record = this.runtime.get(sessionId);
    if (!record) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const ac = this.runtime.beginTurn(sessionId);
    record.extra.permissionCtx.promptSignal = ac.signal;
    record.extra.eventBridge.resetTurn();
    try {
      return await runTurn({
        agent: record.agent,
        text,
        sessionId,
        signal: ac.signal,
        sink: {
          onEvent: async (event) => {
            if (event.type === 'end') return;
            await record.extra.eventBridge.handleStreamEvent(event);
          }
        }
      });
    } finally {
      record.extra.permissionCtx.promptSignal = undefined;
      this.runtime.endTurn(sessionId, ac);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.runtime.close(sessionId);
  }

  async destroySession(sessionId: string): Promise<void> {
    await this.runtime.destroy(sessionId);
  }

  async destroyAll(): Promise<void> {
    await this.runtime.destroyAll();
  }
}
