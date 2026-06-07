import { resolve } from 'node:path';
import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import * as acp from '@agentclientprotocol/sdk';
import type * as acpTypes from '@agentclientprotocol/sdk';
import type { StreamEvent } from '@ddlqhd/agent-sdk';
import { AcpSessionManager } from './session-manager.js';
import type { EditApprovalMode } from './edit-approval.js';
import { logError, logInfo } from './logging.js';

const MODES: acpTypes.SessionMode[] = [
  { id: 'default', name: 'Default', description: 'Ask before edits and dangerous commands' },
  { id: 'accept_edits', name: 'Accept edits', description: 'Auto-approve workspace file edits' },
  { id: 'dont_ask', name: "Don't ask", description: 'Auto-approve edits for this session' }
];

function currentModeId(editMode: EditApprovalMode): string {
  return editMode === 'default' ? 'default' : editMode;
}

function extractPromptText(blocks: acpTypes.ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push(block.text);
    } else if (block.type === 'resource_link') {
      parts.push(`[${block.name || 'attachment'}](${block.uri})`);
    }
  }
  return parts.join('\n').trim();
}

function mapEndReason(event: StreamEvent & { type: 'end' }): acpTypes.StopReason {
  if (event.reason === 'aborted') return 'cancelled';
  if (event.reason === 'max_iterations') return 'max_turn_requests';
  if (event.reason === 'error') return 'refusal';
  return 'end_turn';
}

export class AgentSdkAcpBridge implements acpTypes.Agent {
  readonly sessionManager: AcpSessionManager;

  constructor(connection: AgentSideConnection) {
    this.sessionManager = new AcpSessionManager(connection);
  }

  async initialize(_params: acpTypes.InitializeRequest): Promise<acpTypes.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: true
        },
        sessionCapabilities: {
          list: {},
          fork: {},
          close: {}
        }
      },
      agentInfo: {
        name: 'agent-sdk-acp',
        version: '0.1.0'
      },
      authMethods: []
    };
  }

  async authenticate(_params: acpTypes.AuthenticateRequest): Promise<acpTypes.AuthenticateResponse> {
    return {};
  }

  async newSession(params: acpTypes.NewSessionRequest): Promise<acpTypes.NewSessionResponse> {
    const cwd = resolve(params.cwd);
    const state = await this.sessionManager.createSession(cwd, undefined, {
      mcpServers: params.mcpServers
    });
    logInfo('session/new', state.sessionId);
    return {
      sessionId: state.sessionId,
      modes: {
        availableModes: MODES,
        currentModeId: currentModeId(state.editMode)
      }
    };
  }

  async loadSession(params: acpTypes.LoadSessionRequest): Promise<acpTypes.LoadSessionResponse> {
    const cwd = resolve(params.cwd);
    const state = await this.sessionManager.loadSession(params.sessionId, cwd, params.mcpServers);
    logInfo('session/load', params.sessionId);
    return {
      modes: {
        availableModes: MODES,
        currentModeId: currentModeId(state.editMode)
      }
    };
  }

  async forkSession(params: acpTypes.ForkSessionRequest): Promise<acpTypes.ForkSessionResponse> {
    const forked = await this.sessionManager.forkSession(params.sessionId, params.mcpServers);
    return {
      sessionId: forked.sessionId,
      modes: {
        availableModes: MODES,
        currentModeId: currentModeId(forked.editMode)
      }
    };
  }

  async listSessions(params: acpTypes.ListSessionsRequest): Promise<acpTypes.ListSessionsResponse> {
    return this.sessionManager.listSessions(params.cwd, params.cursor);
  }

  async setSessionMode(params: acpTypes.SetSessionModeRequest): Promise<acpTypes.SetSessionModeResponse> {
    this.sessionManager.setEditMode(params.sessionId, params.modeId);
    return {};
  }

  async prompt(params: acpTypes.PromptRequest): Promise<acpTypes.PromptResponse> {
    const state = this.sessionManager.get(params.sessionId);
    if (!state) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }

    const text = extractPromptText(params.prompt);
    if (!text) {
      return { stopReason: 'end_turn' };
    }

    state.abortController?.abort();
    const ac = new AbortController();
    state.abortController = ac;
    state.permissionCtx.promptSignal = ac.signal;
    state.eventBridge.resetTurn();

    let stopReason: acpTypes.StopReason = 'end_turn';

    try {
      for await (const event of state.agent.stream(text, {
        sessionId: params.sessionId,
        signal: ac.signal
      })) {
        if (event.type === 'end') {
          stopReason = mapEndReason(event);
          continue;
        }
        await state.eventBridge.handleStreamEvent(event);
      }
    } catch (e) {
      if (ac.signal.aborted) {
        return { stopReason: 'cancelled' };
      }
      logError('prompt stream failed', e);
      throw e;
    } finally {
      state.permissionCtx.promptSignal = undefined;
      if (state.abortController === ac) {
        state.abortController = null;
      }
    }

    return { stopReason };
  }

  async cancel(params: acpTypes.CancelNotification): Promise<void> {
    this.sessionManager.cancelPrompt(params.sessionId);
  }

  async closeSession(params: acpTypes.CloseSessionRequest): Promise<acpTypes.CloseSessionResponse> {
    await this.sessionManager.closeSession(params.sessionId);
    return {};
  }
}
