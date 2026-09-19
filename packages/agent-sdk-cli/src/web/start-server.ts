import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join } from 'node:path';
import type {
  Agent,
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionResolver,
  SessionInfo,
  StreamEvent,
  TokenUsage
} from '@ddlqhd/agent-sdk';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import type { ServerMessage, WebUiDefaults } from './shared/ws-protocol.js';
import { messagesToChatHistory, type ChatHistoryItem } from './shared/message-text.js';
import { chatPreview, truncateForLog } from './shared/log-utils.js';
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
  parseClientMessage,
  resolveStaticFile
} from './http-utils.js';
import { persistConfigureSettings } from '../utils/user-settings.js';

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

function toUiDefaults(defaults: WebRuntimeDefaults): WebUiDefaults {
  return {
    cwd: defaults.cwd,
    userBasePath: defaults.userBasePath,
    ...(defaults.mcpConfigPath ? { mcpConfigPath: defaults.mcpConfigPath } : {}),
    ...(defaults.provider ? { provider: defaults.provider } : {}),
    ...(defaults.model ? { model: defaults.model } : {}),
    ...(defaults.temperature !== undefined ? { temperature: defaults.temperature } : {}),
    ...(defaults.contextLength !== undefined ? { contextLength: defaults.contextLength } : {}),
    ...(defaults.thinking !== undefined ? { thinking: defaults.thinking } : {}),
    ...(defaults.thinkingLevel ? { thinkingLevel: defaults.thinkingLevel } : {}),
    ...(defaults.storage ? { storage: defaults.storage } : {}),
    ...(defaults.safeToolsOnly === true ? { safeToolsOnly: true } : {}),
    ...(typeof defaults.memory === 'boolean' ? { memory: defaults.memory } : {}),
    ...(typeof defaults.contextManagement === 'boolean'
      ? { contextManagement: defaults.contextManagement }
      : {})
  };
}

function attachSocketHandlers(
  socket: WebSocket,
  defaults: WebRuntimeDefaults,
  connId: string
): void {
  const state: {
    agentsBySession: Map<string, Agent>;
    activeSessionId: string | null;
    runtimeConfig: BuildAgentOptions | null;
    abortByRequest: Map<string, { sessionId: string; controller: AbortController }>;
  } = {
    agentsBySession: new Map(),
    activeSessionId: null,
    runtimeConfig: null,
    abortByRequest: new Map()
  };

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
    for (const agent of state.agentsBySession.values()) {
      await agent.destroy();
    }
    state.agentsBySession.clear();
    state.activeSessionId = null;
  }

  async function createConfiguredAgent(): Promise<Agent> {
    if (!state.runtimeConfig) {
      throw new Error('Configure the agent first.');
    }
    const { agent } = await buildAgent({ ...state.runtimeConfig, askUserQuestion }, defaults);
    return agent;
  }

  async function loadChatHistory(agent: Agent): Promise<ChatHistoryItem[]> {
    const messages = await agent.getSessionManager().loadActiveMessages();
    return messagesToChatHistory(messages);
  }

  async function sendSessionHistory(sessionId: string, agent: Agent): Promise<void> {
    const messages = await loadChatHistory(agent);
    sendJson(socket, { type: 'sessions:history', sessionId, messages });
  }

  async function resolveSessionAgent(sessionId: string): Promise<Agent | null> {
    let agent = state.agentsBySession.get(sessionId);
    if (agent) return agent;
    if (!state.runtimeConfig) return null;
    agent = await createConfiguredAgent();
    try {
      await agent.getSessionManager().attachSession(sessionId);
    } catch {
      await agent.destroy();
      return null;
    }
    state.agentsBySession.set(sessionId, agent);
    return agent;
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

  let messageQueue = Promise.resolve();
  socket.on('message', (raw: RawData) => {
    messageQueue = messageQueue
      .then(() => handleSocketMessage(raw))
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`${LOG_PREFIX} [${connId}] handler error:`, message);
        sendJson(socket, { type: 'error', message });
      });
  });

  async function handleSocketMessage(raw: RawData): Promise<void> {
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

    try {
      switch (msg.type) {
        case 'hello':
          console.log(`${LOG_PREFIX} [${connId}] inbound hello`);
          sendJson(socket, { type: 'hello_ok', defaults: toUiDefaults(defaults) });
          return;

        case 'configure': {
          console.log(
            `${LOG_PREFIX} [${connId}] configure provider=${msg.provider} model=${msg.model} storage=${msg.storage} safeToolsOnly=${msg.safeToolsOnly === true} persist=${msg.persist === true} contextLength=${msg.contextLength ?? '(default)'} thinking=${msg.thinking !== undefined ? String(msg.thinking) : '(default)'} thinkingLevel=${msg.thinkingLevel ?? '(default)'} cwd=${msg.cwd ? truncateForLog(msg.cwd) : '(default)'} userBasePath=${msg.userBasePath ? truncateForLog(msg.userBasePath) : '(default)'} mcpConfigPath=${msg.mcpConfigPath ? truncateForLog(msg.mcpConfigPath) : '(none)'}`
          );
          const persistWarnings: string[] = [];
          if (msg.persist === true) {
            try {
              persistConfigureSettings(defaults.userBasePath, {
                provider: msg.provider,
                model: msg.model,
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
          const { agent, warnings } = await buildAgent(
            { ...state.runtimeConfig, askUserQuestion },
            defaults
          );
          const allWarnings = [...persistWarnings, ...warnings];
          const sessionId = agent.getSessionManager().createSession();
          state.agentsBySession.set(sessionId, agent);
          state.activeSessionId = sessionId;
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
          const activeAgent = state.agentsBySession.get(activeSessionId);
          if (!activeAgent) {
            console.warn(`${LOG_PREFIX} [${connId}] sessions:list rejected: Active session runtime not found.`);
            sendJson(socket, { type: 'error', message: 'Active session runtime not found.' });
            return;
          }
          const sessions = await activeAgent.getSessionManager().listSessions();
          sendJson(socket, {
            type: 'sessions:list',
            sessions: sessions.map((s: SessionInfo) => ({
              id: s.id,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
              messageCount: s.messageCount
            }))
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
          abortSessionRequests(state.activeSessionId);
          const agent = await createConfiguredAgent();
          const id = agent.getSessionManager().createSession(msg.sessionId);
          state.agentsBySession.set(id, agent);
          state.activeSessionId = id;
          console.log(`${LOG_PREFIX} [${connId}] sessions:new ok sessionId=${id.slice(0, 8)}…`);
          sendJson(socket, { type: 'sessions:new', sessionId: id });
          return;
        }

        case 'sessions:resume': {
          console.log(`${LOG_PREFIX} [${connId}] sessions:resume sessionId=${msg.sessionId.slice(0, 8)}…`);
          if (!state.runtimeConfig) {
            console.warn(`${LOG_PREFIX} [${connId}] sessions:resume rejected: Configure the agent first.`);
            sendJson(socket, { type: 'error', message: 'Configure the agent first.' });
            return;
          }
          if (state.agentsBySession.has(msg.sessionId)) {
            state.activeSessionId = msg.sessionId;
            const existing = state.agentsBySession.get(msg.sessionId)!;
            console.log(`${LOG_PREFIX} [${connId}] sessions:resume ok (existing runtime)`);
            sendJson(socket, { type: 'ready', sessionId: msg.sessionId });
            await sendSessionHistory(msg.sessionId, existing);
            return;
          }
          const agent = await createConfiguredAgent();
          try {
            await agent.getSessionManager().attachSession(msg.sessionId);
          } catch {
            await agent.destroy();
            console.warn(`${LOG_PREFIX} [${connId}] sessions:resume failed: session not found`);
            sendJson(socket, {
              type: 'error',
              message: `Session not found: ${msg.sessionId}`
            });
            return;
          }
          state.agentsBySession.set(msg.sessionId, agent);
          state.activeSessionId = msg.sessionId;
          console.log(`${LOG_PREFIX} [${connId}] sessions:resume ok (loaded)`);
          sendJson(socket, { type: 'ready', sessionId: msg.sessionId });
          await sendSessionHistory(msg.sessionId, agent);
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

          const result = await sourceAgent.forkSession(sourceSessionId, forkOpts);
          const newAgent = await createConfiguredAgent();
          await newAgent.getSessionManager().attachSession(result.sessionId);
          state.agentsBySession.set(result.sessionId, newAgent);
          state.activeSessionId = result.sessionId;
          const messages = await loadChatHistory(newAgent);
          sendJson(socket, {
            type: 'sessions:fork',
            sessionId: result.sessionId,
            sourceSessionId: result.sourceSessionId,
            result,
            messages
          });
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
            return;
          }
          const requestedSessionId = msg.sessionId || state.activeSessionId;
          if (!requestedSessionId) {
            console.warn(
              `${LOG_PREFIX} [${connId}] ${msg.type} rejected: No active session. Create or resume a session first.`
            );
            sendJson(socket, { type: 'error', message: 'No active session. Create or resume a session first.' });
            return;
          }
          const { len, preview } = chatPreview(msg.text);
          console.log(
            `${LOG_PREFIX} [${connId}] ${msg.type} requestId=${msg.requestId} sessionId=${requestedSessionId.slice(0, 8)}… textLen=${len} preview=${JSON.stringify(preview)}`
          );
          let targetAgent = state.agentsBySession.get(requestedSessionId);
          if (!targetAgent) {
            targetAgent = await createConfiguredAgent();
            targetAgent.getSessionManager().createSession(requestedSessionId);
            state.agentsBySession.set(requestedSessionId, targetAgent);
            console.log(`${LOG_PREFIX} [${connId}] chat: created new agent runtime for session`);
          }
          state.activeSessionId = requestedSessionId;

          const requestId = msg.requestId;
          const ac = new AbortController();
          state.abortByRequest.set(requestId, { sessionId: requestedSessionId, controller: ac });

          try {
            let finalText = '';
            let lastUsage: TokenUsage | undefined;
            for await (const event of targetAgent.stream(msg.text, {
              sessionId: requestedSessionId,
              signal: ac.signal,
              forkSession: msg.forkSession === true
            })) {
              if (event.type === 'text_delta') {
                finalText += event.content;
              }
              if (event.type === 'session_summary') {
                lastUsage = event.usage;
              }
              if (event.type === 'end' && event.usage !== undefined) {
                lastUsage = event.usage;
              }
              sendJson(socket, { type: 'stream_event', event: serializeStreamEvent(event) });
            }
            const sid = targetAgent.getSessionManager().sessionId || requestedSessionId;
            console.log(
              `${LOG_PREFIX} [${connId}] chat_done ok requestId=${requestId} sessionId=${sid.slice(0, 8)}… finalTextLen=${finalText.length} usage=${lastUsage ? JSON.stringify(lastUsage) : 'none'}`
            );
            sendJson(socket, {
              type: 'chat_done',
              requestId,
              sessionId: sid,
              finalText,
              usage: lastUsage
            });
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
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
            sendJson(socket, {
              type: 'chat_done',
              requestId,
              sessionId: targetAgent.getSessionManager().sessionId || requestedSessionId,
              finalText: ''
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

/**
 * Serve the Agent Studio UI and WebSocket `/ws` on the given host/port.
 * Resolves when the process receives SIGINT/SIGTERM (or the HTTP server closes).
 */
export async function startWebServer(options: StartWebServerOptions): Promise<void> {
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

  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${LOG_PREFIX} received ${signal}, shutting down`);
      try {
        await closeSharedAgentLogger();
      } catch (err) {
        console.error(`${LOG_PREFIX} error closing SDK logger:`, err);
      }
      try {
        await closeHttpAndWebSockets(server, wss);
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
