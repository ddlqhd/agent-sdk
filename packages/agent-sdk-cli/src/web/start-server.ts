import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, isAbsolute, join, resolve } from 'node:path';
import type {
  Agent,
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionResolver,
  SessionInfo,
  StreamEvent
} from '@ddlqhd/agent-sdk';
import { SessionRuntime, runTurn } from '@ddlqhd/agent-sdk-control';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import type { ClientMessage, ServerMessage, SessionListItem } from './shared/ws-protocol.js';
import {
  firstUserQuestionTitle,
  messagesToChatHistory,
  type ChatHistoryItem
} from './shared/message-text.js';
import { chatPreview, formatBaseUrlForLog, truncateForLog } from './shared/log-utils.js';
import {
  buildAgent,
  closeSharedAgentLogger,
  getSharedAgentLogger,
  initSharedAgentLogger,
  type BuildAgentOptions,
  type WebRuntimeDefaults
} from './agent-factory.js';
import { serializeStreamEvent } from './serialize-event.js';
import {
  assertLoopbackBind,
  isAllowedWsOrigin,
  isImmediateClientMessage,
  parseClientMessage,
  resolveStaticFile
} from './http-utils.js';
import { loadUserSettings, persistConfigureSettings } from '../utils/user-settings.js';
import {
  applyPersistedModelDefaults,
  snapshotModelDefaults,
  withModelDefaults
} from './model-defaults.js';
import { toUiDefaults } from './ui-defaults.js';

const LOG_PREFIX = '[agent-sdk web]';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

export interface StartWebServerOptions {
  port: number;
  host: string;
  clientDist: string;
  defaults: WebRuntimeDefaults;
  /** Bind non-loopback interfaces and skip WebSocket Origin checks. */
  allowRemote?: boolean;
}

function sendJson(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function attachSocketHandlers(
  socket: WebSocket,
  defaults: WebRuntimeDefaults,
  connId: string
): void {
  const state: {
    runtime: SessionRuntime;
    activeSessionId: string | null;
    runtimeConfig: BuildAgentOptions | null;
    abortByRequest: Map<string, { sessionId: string; controller: AbortController }>;
  } = {
    runtime: null as unknown as SessionRuntime,
    activeSessionId: null,
    runtimeConfig: null,
    abortByRequest: new Map()
  };

  /**
   * Model defaults owned by this connection. Captured at attach and rewritten only by
   * this connection's own persist: a persist from another connection updates the shared
   * `defaults` (so later connections see the file) but must not change what an already
   * configured connection falls back to.
   */
  const modelSeed = snapshotModelDefaults(defaults);

  function resolvedCwd(): string {
    const raw = state.runtimeConfig?.cwd?.trim();
    if (!raw) return defaults.cwd;
    return isAbsolute(raw) ? raw : resolve(defaults.cwd, raw);
  }

  function resolvedUserBase(): string {
    const raw = state.runtimeConfig?.userBasePath?.trim();
    if (!raw) return defaults.userBasePath;
    return isAbsolute(raw) ? raw : resolve(defaults.userBasePath, raw);
  }

  state.runtime = new SessionRuntime({
    resolveUserBasePath: resolvedUserBase,
    storageType: () => state.runtimeConfig?.storage ?? 'jsonl',
    createExtra: () => undefined,
    buildAgent: async () => createConfiguredAgent()
  });

  const askPending = new Map<
    string,
    {
      resolve: (answers: AskUserQuestionAnswer[]) => void;
      reject: (e: Error) => void;
    }
  >();

  function rejectAllAskPending(reason: string): void {
    const err = new Error(reason);
    for (const [, p] of askPending) {
      p.reject(err);
    }
    askPending.clear();
  }

  const askUserQuestion: AskUserQuestionResolver = (
    questions: AskUserQuestionItem[],
    options?: { signal?: AbortSignal }
  ) =>
    new Promise((resolve, reject) => {
      if (options?.signal?.aborted) {
        const abortErr = new Error('The operation was aborted.');
        abortErr.name = 'AbortError';
        reject(abortErr);
        return;
      }
      const id = randomUUID();
      const onAbort = () => {
        options?.signal?.removeEventListener('abort', onAbort);
        askPending.delete(id);
        const abortErr = new Error('The operation was aborted.');
        abortErr.name = 'AbortError';
        reject(abortErr);
      };
      if (options?.signal) {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
      askPending.set(id, {
        resolve: (answers) => {
          options?.signal?.removeEventListener('abort', onAbort);
          resolve(answers);
        },
        reject: (e) => {
          options?.signal?.removeEventListener('abort', onAbort);
          reject(e);
        }
      });
      sendJson(socket, { type: 'ask_user_question', requestId: id, questions });
    });

  async function destroyAllAgents(): Promise<void> {
    await state.runtime.destroyAll();
    state.activeSessionId = null;
  }

  let lastBuildWarnings: string[] = [];

  async function createConfiguredAgent(): Promise<Agent> {
    if (!state.runtimeConfig) {
      throw new Error('Configure the agent first.');
    }
    const { agent, warnings } = await buildAgent(
      { ...state.runtimeConfig, askUserQuestion },
      withModelDefaults(defaults, modelSeed)
    );
    lastBuildWarnings = warnings;
    return agent;
  }

  async function loadChatHistory(agent: Agent): Promise<ChatHistoryItem[]> {
    const messages = await agent.getSessionManager().loadActiveMessages();
    return messagesToChatHistory(messages);
  }

  async function sendSessionHistory(sessionId: string, agent: Agent): Promise<void> {
    const messages = await loadChatHistory(agent);
    sendJson(socket, { type: 'sessions:history', sessionId, messages });
    sendSessionStats(sessionId, agent);
  }

  /** 下发会话累计指标（输入框下方页脚） */
  function sendSessionStats(sessionId: string, agent: Agent): void {
    sendJson(socket, {
      type: 'session_stats',
      sessionId,
      stats: agent.getSessionUsageSummary()
    });
  }

  async function resolveSessionAgent(sessionId: string): Promise<Agent | null> {
    const existing = state.runtime.get(sessionId);
    if (existing) return existing.agent;
    if (!state.runtimeConfig) return null;
    try {
      const record = await state.runtime.load(sessionId, resolvedCwd());
      return record.agent;
    } catch {
      return null;
    }
  }

  async function startNewSession(requestedSessionId?: string): Promise<string> {
    abortSessionRequests(state.activeSessionId);
    const record = await state.runtime.create(resolvedCwd(), requestedSessionId);
    state.activeSessionId = record.sessionId;
    return record.sessionId;
  }

  function abortSessionRequests(sessionId: string | null): void {
    if (!sessionId) return;
    let aborted = false;
    for (const [requestId, request] of state.abortByRequest.entries()) {
      if (request.sessionId === sessionId) {
        request.controller.abort();
        state.abortByRequest.delete(requestId);
        aborted = true;
      }
    }
    if (aborted) {
      rejectAllAskPending('session_aborted');
    }
  }

  function reportHandlerError(e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${LOG_PREFIX} [${connId}] handler error:`, message);
    sendJson(socket, { type: 'error', message });
  }

  let messageQueue = Promise.resolve();
  socket.on('message', (raw: RawData) => {
    const rawStr = String(raw);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawStr);
    } catch {
      console.warn(`${LOG_PREFIX} [${connId}] invalid JSON (length=${rawStr.length})`);
      sendJson(socket, { type: 'error', message: 'Invalid JSON' });
      return;
    }
    const parsed = parseClientMessage(parsedJson);
    if (!parsed.ok) {
      console.warn(`${LOG_PREFIX} [${connId}] ${parsed.error}`);
      sendJson(socket, { type: 'error', message: parsed.error });
      return;
    }
    const msg = parsed.msg;
    // cancel / ask reply must not wait behind an in-flight chat stream
    if (isImmediateClientMessage(msg.type)) {
      void handleSocketMessage(msg).catch(reportHandlerError);
      return;
    }
    messageQueue = messageQueue.then(() => handleSocketMessage(msg)).catch(reportHandlerError);
  });

  async function handleSocketMessage(msg: ClientMessage): Promise<void> {
    try {
      switch (msg.type) {
        case 'hello':
          console.log(`${LOG_PREFIX} [${connId}] inbound hello`);
          sendJson(socket, {
            type: 'hello_ok',
            defaults: toUiDefaults(withModelDefaults(defaults, modelSeed))
          });
          return;

        case 'configure': {
          console.log(
            `${LOG_PREFIX} [${connId}] configure provider=${msg.provider} model=${msg.model} baseUrl=${formatBaseUrlForLog(msg.baseUrl)} apiKey=${msg.apiKey ? '(set)' : msg.apiKey === null ? '(cleared)' : '(default)'} storage=${msg.storage} safeToolsOnly=${msg.safeToolsOnly === true} persist=${msg.persist === true} contextLength=${msg.contextLength ?? '(default)'} thinking=${msg.thinking !== undefined ? String(msg.thinking) : '(default)'} thinkingLevel=${msg.thinkingLevel ?? '(default)'} cwd=${msg.cwd ? truncateForLog(msg.cwd) : '(default)'} userBasePath=${msg.userBasePath ? truncateForLog(msg.userBasePath) : '(default)'} mcpConfigPath=${msg.mcpConfigPath ? truncateForLog(msg.mcpConfigPath) : '(none)'}`
          );
          const persistWarnings: string[] = [];
          if (msg.persist === true) {
            try {
              persistConfigureSettings(defaults.userBasePath, {
                provider: msg.provider,
                model: msg.model,
                baseUrl: msg.baseUrl,
                apiKey: msg.apiKey,
                temperature: msg.temperature,
                thinking: msg.thinking,
                thinkingLevel: msg.thinkingLevel,
                memory: msg.memory,
                contextManagement: msg.contextManagement,
                contextLength: msg.contextLength,
                mcpConfigPath: msg.mcpConfigPath,
                storage: msg.storage,
                safeToolsOnly: msg.safeToolsOnly
              });
              const storedModel = loadUserSettings(defaults.userBasePath)?.agentDefaultModel;
              // Refresh this connection's snapshot and the server-wide defaults; other
              // connections keep the snapshot they captured at attach.
              applyPersistedModelDefaults(defaults, modelSeed, {
                provider: storedModel?.provider ?? msg.provider,
                model: storedModel?.model ?? msg.model,
                baseUrl: storedModel?.baseUrl,
                apiKey: storedModel?.apiKey
              });
            } catch (err) {
              const detail = err instanceof Error ? err.message : String(err);
              persistWarnings.push(`Failed to save settings: ${detail}`);
              console.warn(`${LOG_PREFIX} [${connId}] persist settings failed: ${detail}`);
            }
          }
          rejectAllAskPending('reconfigured');
          await destroyAllAgents();
          state.runtimeConfig = {
            provider: msg.provider,
            model: msg.model,
            baseUrl: msg.baseUrl,
            apiKey: msg.apiKey,
            temperature: msg.temperature,
            contextLength: msg.contextLength,
            storage: msg.storage,
            safeToolsOnly: msg.safeToolsOnly === true,
            memory: msg.memory,
            contextManagement: msg.contextManagement !== false,
            mcpConfigPath: msg.mcpConfigPath,
            cwd: msg.cwd,
            userBasePath: msg.userBasePath,
            thinking: msg.thinking,
            thinkingLevel: msg.thinkingLevel
          };
          const record = await state.runtime.create(resolvedCwd());
          const sessionId = record.sessionId;
          state.activeSessionId = sessionId;
          const allWarnings = [...persistWarnings, ...lastBuildWarnings];
          console.log(
            `${LOG_PREFIX} [${connId}] ready sessionId=${sessionId.slice(0, 8)}… warnings=${allWarnings.length}`
          );
          sendJson(socket, {
            type: 'ready',
            warnings: allWarnings.length ? allWarnings : undefined,
            sessionId
          });
          return;
        }

        case 'sessions:list': {
          console.log(`${LOG_PREFIX} [${connId}] sessions:list`);
          const activeSessionId = state.activeSessionId;
          if (!activeSessionId) {
            console.warn(`${LOG_PREFIX} [${connId}] sessions:list rejected: Configure the agent first.`);
            sendJson(socket, { type: 'error', message: 'Configure the agent first.' });
            return;
          }
          const activeRecord = state.runtime.get(activeSessionId);
          if (!activeRecord) {
            console.warn(`${LOG_PREFIX} [${connId}] sessions:list rejected: Active session runtime not found.`);
            sendJson(socket, { type: 'error', message: 'Active session runtime not found.' });
            return;
          }
          const manager = activeRecord.agent.getSessionManager();
          const storage = manager.getStorage();
          const sessions = await manager.listSessions();
          const items: SessionListItem[] = await Promise.all(
            sessions.map(async (s: SessionInfo) => {
              let title: string | undefined;
              try {
                title = firstUserQuestionTitle(await storage.load(s.id));
              } catch {
                title = undefined;
              }
              return {
                id: s.id,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                messageCount: s.messageCount,
                ...(title ? { title } : {})
              };
            })
          );
          sendJson(socket, {
            type: 'sessions:list',
            sessions: items
          });
          return;
        }

        case 'sessions:new': {
          console.log(`${LOG_PREFIX} [${connId}] sessions:new requestedSessionId=${msg.sessionId ?? '(auto)'}`);
          if (!state.runtimeConfig) {
            console.warn(`${LOG_PREFIX} [${connId}] sessions:new rejected: Configure the agent first.`);
            sendJson(socket, { type: 'error', message: 'Configure the agent first.' });
            return;
          }
          const id = await startNewSession(msg.sessionId);
          console.log(`${LOG_PREFIX} [${connId}] sessions:new ok sessionId=${id.slice(0, 8)}…`);
          sendJson(socket, { type: 'sessions:new', sessionId: id });
          return;
        }

        case 'sessions:delete': {
          console.log(`${LOG_PREFIX} [${connId}] sessions:delete sessionId=${msg.sessionId.slice(0, 8)}…`);
          if (!state.runtimeConfig) {
            console.warn(`${LOG_PREFIX} [${connId}] sessions:delete rejected: Configure the agent first.`);
            sendJson(socket, { type: 'error', message: 'Configure the agent first.' });
            return;
          }
          const target = state.runtime.get(msg.sessionId);
          const deleter =
            target ?? (state.activeSessionId ? state.runtime.get(state.activeSessionId) : undefined);
          if (!deleter) {
            console.warn(`${LOG_PREFIX} [${connId}] sessions:delete rejected: Active session runtime not found.`);
            sendJson(socket, { type: 'error', message: 'Active session runtime not found.' });
            return;
          }
          abortSessionRequests(msg.sessionId);
          await state.runtime.deleteStored(msg.sessionId);
          const wasActive = state.activeSessionId === msg.sessionId;
          if (wasActive) {
            state.activeSessionId = null;
          }
          console.log(`${LOG_PREFIX} [${connId}] sessions:delete ok sessionId=${msg.sessionId.slice(0, 8)}…`);
          sendJson(socket, { type: 'sessions:deleted', sessionId: msg.sessionId });
          if (wasActive) {
            const id = await startNewSession();
            console.log(`${LOG_PREFIX} [${connId}] sessions:new ok sessionId=${id.slice(0, 8)}… (after delete)`);
            sendJson(socket, { type: 'sessions:new', sessionId: id });
          }
          return;
        }

        case 'sessions:resume': {
          console.log(`${LOG_PREFIX} [${connId}] sessions:resume sessionId=${msg.sessionId.slice(0, 8)}…`);
          if (!state.runtimeConfig) {
            console.warn(`${LOG_PREFIX} [${connId}] sessions:resume rejected: Configure the agent first.`);
            sendJson(socket, { type: 'error', message: 'Configure the agent first.' });
            return;
          }
          if (state.runtime.get(msg.sessionId)) {
            state.activeSessionId = msg.sessionId;
            const existing = state.runtime.get(msg.sessionId)!;
            console.log(`${LOG_PREFIX} [${connId}] sessions:resume ok (existing runtime)`);
            sendJson(socket, { type: 'ready', sessionId: msg.sessionId });
            await sendSessionHistory(msg.sessionId, existing.agent);
            return;
          }
          try {
            const loaded = await state.runtime.load(msg.sessionId, resolvedCwd());
            state.activeSessionId = msg.sessionId;
            console.log(`${LOG_PREFIX} [${connId}] sessions:resume ok (loaded)`);
            sendJson(socket, { type: 'ready', sessionId: msg.sessionId });
            await sendSessionHistory(msg.sessionId, loaded.agent);
          } catch {
            console.warn(`${LOG_PREFIX} [${connId}] sessions:resume failed: session not found`);
            sendJson(socket, {
              type: 'error',
              message: `Session not found: ${msg.sessionId}`
            });
          }
          return;
        }

        case 'sessions:checkpoints': {
          const sessionId = msg.sessionId ?? state.activeSessionId;
          if (!sessionId) {
            sendJson(socket, { type: 'error', message: 'No active session.' });
            return;
          }
          const agent = await resolveSessionAgent(sessionId);
          if (!agent) {
            sendJson(socket, { type: 'error', message: `Session not found: ${sessionId}` });
            return;
          }
          const checkpoints = await agent.listSessionCheckpoints();
          sendJson(socket, { type: 'sessions:checkpoints', sessionId, checkpoints });
          return;
        }

        case 'sessions:rewind': {
          const sessionId = msg.sessionId ?? state.activeSessionId;
          if (!sessionId) {
            sendJson(socket, { type: 'error', message: 'No active session.' });
            return;
          }
          abortSessionRequests(sessionId);
          const agent = await resolveSessionAgent(sessionId);
          if (!agent) {
            sendJson(socket, { type: 'error', message: `Session not found: ${sessionId}` });
            return;
          }
          const rewindOpts =
            msg.checkpointId !== undefined
              ? { checkpointId: msg.checkpointId }
              : msg.userTurnIndex !== undefined
                ? { userTurnIndex: msg.userTurnIndex }
                : null;
          if (!rewindOpts) {
            sendJson(socket, {
              type: 'error',
              message: 'Specify checkpointId or userTurnIndex for rewind.'
            });
            return;
          }
          const result = await agent.rewindToCheckpoint(rewindOpts);
          const messages = await loadChatHistory(agent);
          sendJson(socket, { type: 'sessions:rewind', sessionId, result, messages });
          sendSessionStats(sessionId, agent);
          return;
        }

        case 'sessions:fork': {
          const sourceSessionId = msg.sessionId ?? state.activeSessionId;
          if (!sourceSessionId) {
            sendJson(socket, { type: 'error', message: 'No active session.' });
            return;
          }
          abortSessionRequests(sourceSessionId);
          const sourceAgent = await resolveSessionAgent(sourceSessionId);
          if (!sourceAgent) {
            sendJson(socket, { type: 'error', message: `Session not found: ${sourceSessionId}` });
            return;
          }
          const forkOpts: {
            newSessionId?: string;
            checkpointId?: string;
            userTurnIndex?: number;
          } = {};
          if (msg.newSessionId) forkOpts.newSessionId = msg.newSessionId;
          if (msg.checkpointId) forkOpts.checkpointId = msg.checkpointId;
          if (msg.userTurnIndex !== undefined) forkOpts.userTurnIndex = msg.userTurnIndex;

          const forked = await state.runtime.fork(sourceSessionId, {
            cwd: resolvedCwd(),
            ...forkOpts
          });
          state.activeSessionId = forked.sessionId;
          const messages = await loadChatHistory(forked.agent);
          sendJson(socket, {
            type: 'sessions:fork',
            sessionId: forked.sessionId,
            sourceSessionId: forked.forkResult.sourceSessionId,
            result: forked.forkResult,
            messages
          });
          sendSessionStats(forked.sessionId, forked.agent);
          return;
        }

        case 'cancel': {
          console.log(`${LOG_PREFIX} [${connId}] cancel requestId=${msg.requestId}`);
          const request = state.abortByRequest.get(msg.requestId);
          request?.controller.abort();
          rejectAllAskPending('cancelled');
          return;
        }

        case 'ask_user_question_reply': {
          console.log(`${LOG_PREFIX} [${connId}] ask_user_question_reply requestId=${msg.requestId}`);
          const p = askPending.get(msg.requestId);
          if (p) {
            p.resolve(msg.answers);
            askPending.delete(msg.requestId);
          }
          return;
        }

        case 'chat':
        case 'chat_run': {
          if (!state.runtimeConfig) {
            console.warn(`${LOG_PREFIX} [${connId}] ${msg.type} rejected: Configure the agent first.`);
            sendJson(socket, { type: 'error', message: 'Configure the agent first.' });
            sendJson(socket, {
              type: 'chat_done',
              requestId: msg.requestId,
              sessionId: msg.sessionId || '',
              finalText: ''
            });
            return;
          }
          const requestedSessionId = msg.sessionId || state.activeSessionId;
          if (!requestedSessionId) {
            console.warn(
              `${LOG_PREFIX} [${connId}] ${msg.type} rejected: No active session. Create or resume a session first.`
            );
            sendJson(socket, { type: 'error', message: 'No active session. Create or resume a session first.' });
            sendJson(socket, {
              type: 'chat_done',
              requestId: msg.requestId,
              sessionId: '',
              finalText: ''
            });
            return;
          }
          const { len, preview } = chatPreview(msg.text);
          console.log(
            `${LOG_PREFIX} [${connId}] ${msg.type} requestId=${msg.requestId} sessionId=${requestedSessionId.slice(0, 8)}… textLen=${len} preview=${JSON.stringify(preview)}`
          );
          let target = state.runtime.get(requestedSessionId);
          const requestId = msg.requestId;
          const ac = new AbortController();
          state.abortByRequest.set(requestId, { sessionId: requestedSessionId, controller: ac });

          try {
            if (!target) {
              target = await state.runtime.create(resolvedCwd(), requestedSessionId);
              console.log(`${LOG_PREFIX} [${connId}] chat: created new agent runtime for session`);
            }
            state.activeSessionId = requestedSessionId;
            const result = await runTurn({
              agent: target.agent,
              text: msg.text,
              sessionId: requestedSessionId,
              signal: ac.signal,
              forkSession: msg.forkSession === true,
              sink: {
                onEvent: (event) => {
                  sendJson(socket, { type: 'stream_event', event: serializeStreamEvent(event) });
                }
              }
            });
            const sid = target.agent.getSessionManager().sessionId || requestedSessionId;
            const turn = target.agent.getLastTurnStats();
            const session = target.agent.getSessionUsageSummary();
            console.log(
              `${LOG_PREFIX} [${connId}] chat_done ok requestId=${requestId} sessionId=${sid.slice(0, 8)}… finalTextLen=${result.finalText.length} usage=${result.usage ? JSON.stringify(result.usage) : 'none'}`
            );
            sendJson(socket, {
              type: 'chat_done',
              requestId,
              sessionId: sid,
              finalText: result.finalText,
              usage: result.usage,
              turn,
              session
            });
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            const sessionId = target?.agent.getSessionManager().sessionId || requestedSessionId;
            console.error(
              `${LOG_PREFIX} [${connId}] chat stream error requestId=${requestId} sessionId=${requestedSessionId.slice(0, 8)}…`,
              err.message,
              e instanceof Error ? e.stack : ''
            );
            sendJson(socket, {
              type: 'stream_event',
              event: serializeStreamEvent({
                type: 'end',
                timestamp: Date.now(),
                reason: 'error',
                error: err
              } as StreamEvent)
            });
            const failedTurn = target?.agent.getLastTurnStats();
            const failedSession = target?.agent.getSessionUsageSummary();
            sendJson(socket, {
              type: 'chat_done',
              requestId,
              sessionId,
              finalText: '',
              ...(failedTurn ? { turn: failedTurn } : {}),
              ...(failedSession ? { session: failedSession } : {})
            });
          } finally {
            state.abortByRequest.delete(requestId);
          }
          return;
        }

        default:
          console.warn(`${LOG_PREFIX} [${connId}] unknown message type`);
          sendJson(socket, { type: 'error', message: 'Unknown message type' });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`${LOG_PREFIX} [${connId}] handler error:`, message);
      sendJson(socket, { type: 'error', message });
    }
  }

  socket.on('close', (code: number, reason: Buffer) => {
    const reasonStr = reason?.length ? reason.toString() : '';
    console.log(
      `${LOG_PREFIX} ws disconnected connId=${connId} code=${code}${reasonStr ? ` reason=${reasonStr}` : ''}`
    );
    rejectAllAskPending('disconnected');
    for (const request of state.abortByRequest.values()) {
      request.controller.abort();
    }
    state.abortByRequest.clear();
    void destroyAllAgents();
  });
}

function listenHttp(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('error', onError);
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${port} is already in use. Stop the other process or pass --port / PORT.`
          )
        );
        return;
      }
      reject(err);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

/**
 * Serve the Agent Studio UI and WebSocket `/ws` on the given host/port.
 * Resolves when the process receives SIGINT/SIGTERM (or the HTTP server closes).
 */
export async function closeHttpAndWebSockets(
  server: Server,
  wss: WebSocketServer,
  options?: { timeoutMs?: number }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 2000;
  for (const client of wss.clients) {
    client.close(1001, 'shutting down');
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      for (const client of wss.clients) {
        client.terminate();
      }
      server.closeAllConnections();
      done();
    }, timeoutMs);
    wss.close();
    server.close(() => done());
  });
}

export interface WebServerHandle {
  close: () => Promise<void>;
}

/**
 * Bind HTTP + `/ws` and return a handle. Used by {@link startWebServer} and integration tests.
 */
export async function createWebListener(options: StartWebServerOptions): Promise<WebServerHandle> {
  const { port, host, clientDist, defaults } = options;
  const allowRemote = options.allowRemote === true;
  if (!existsSync(join(clientDist, 'index.html'))) {
    throw new Error(
      `Web UI assets not found at ${clientDist}. Build the CLI package first (pnpm --filter @ddlqhd/agent-sdk-cli build).`
    );
  }
  assertLoopbackBind(host, port, allowRemote);

  initSharedAgentLogger(defaults.userBasePath, defaults.logFile, defaults.logLevel);

  const server = createServer((req, res) => {
    const file = resolveStaticFile(clientDist, req.url || '/');
    if (!file) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const type = MIME[extname(file)] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.end(readFileSync(file));
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const requestHost = req.headers.host || host;
    let pathname: string;
    try {
      pathname = new URL(req.url || '/', `http://${requestHost}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const originHeader = req.headers.origin;
    const origin = typeof originHeader === 'string' ? originHeader : undefined;
    if (!isAllowedWsOrigin(origin, host, port, allowRemote)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (socket: WebSocket) => {
    const connId = randomUUID().slice(0, 8);
    console.log(`${LOG_PREFIX} ws connected connId=${connId}`);
    attachSocketHandlers(socket, defaults, connId);
  });

  await listenHttp(server, port, host);

  console.log(`${LOG_PREFIX} cwd ${defaults.cwd}`);
  console.log(`${LOG_PREFIX} listening on http://${host}:${port}`);
  if (allowRemote) {
    console.warn(
      `${LOG_PREFIX} --allow-remote: WebSocket Origin checks are disabled. Anyone who can reach ${host}:${port} can run tools.`
    );
  }
  const logInfo = getSharedAgentLogger();
  if (logInfo.filePath) {
    console.log(`${LOG_PREFIX} SDK logs: ${logInfo.filePath} (level=${logInfo.level})`);
  } else {
    console.log(`${LOG_PREFIX} SDK logs: disabled (level=${logInfo.level})`);
  }

  return {
    close: async () => {
      try {
        await closeSharedAgentLogger();
      } catch (err) {
        console.error(`${LOG_PREFIX} error closing SDK logger:`, err);
      }
      await closeHttpAndWebSockets(server, wss);
    }
  };
}

/**
 * Serve the Agent Studio UI and WebSocket `/ws` on the given host/port.
 * Resolves when the process receives SIGINT/SIGTERM (or the HTTP server closes).
 */
export async function startWebServer(options: StartWebServerOptions): Promise<void> {
  const handle = await createWebListener(options);
  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${LOG_PREFIX} received ${signal}, shutting down`);
      try {
        await handle.close();
      } catch (err) {
        console.error(`${LOG_PREFIX} error during shutdown:`, err);
      }
      resolve();
    };
    process.once('SIGINT', () => {
      void shutdown('SIGINT');
    });
    process.once('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
  });
}
