import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import type {
  Agent,
  AskUserQuestionAnswer,
  AskUserQuestionResolver,
  SessionInfo,
  StreamEvent,
  TokenUsage
} from 'agent-sdk';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import type { ClientMessage, ServerMessage } from '../shared/ws-protocol.js';
import { chatPreview, truncateForLog } from '../shared/log-utils.js';
import { buildAgent, type BuildAgentOptions } from './agent-factory.js';
import { CLIENT_DIST, WEB_DEMO_ROOT } from './paths.js';
import { serializeStreamEvent } from './serialize-event.js';

const LOG_PREFIX = '[web-demo]';

const PORT = Number(process.env.PORT) || 3001;
const PROD =
  process.env.NODE_ENV === 'production' &&
  existsSync(join(CLIENT_DIST, 'index.html'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function sendJson(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function safeJoinStatic(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] || '/');
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = normalize(join(CLIENT_DIST, rel));
  if (!resolved.startsWith(normalize(CLIENT_DIST))) return null;
  return resolved;
}

const server = createServer((req, res) => {
  if (!PROD) {
    res.statusCode = 503;
    res.end('Dev mode: use Vite on port 5173; WS on this port.');
    return;
  }
  const file = safeJoinStatic(req.url || '/');
  if (!file || !existsSync(file)) {
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
  const host = req.headers.host || 'localhost';
  const pathname = new URL(req.url || '/', `http://${host}`).pathname;
  if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

interface ConnState {
  agentsBySession: Map<string, Agent>;
  activeSessionId: string | null;
  /** Set by `configure`; includes `safeToolsOnly` when present. */
  runtimeConfig: BuildAgentOptions | null;
  abortByRequest: Map<string, { sessionId: string; controller: AbortController }>;
}

wss.on('connection', (socket: WebSocket) => {
  const connId = randomUUID().slice(0, 8);
  console.log(`${LOG_PREFIX} ws connected connId=${connId}`);

  const state: ConnState = {
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

  const askUserQuestion: AskUserQuestionResolver = (questions) =>
    new Promise((resolve, reject) => {
      const id = randomUUID();
      askPending.set(id, { resolve, reject });
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
    const { agent } = await buildAgent({ ...state.runtimeConfig, askUserQuestion });
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

  socket.on('message', async (raw: RawData) => {
    const rawStr = String(raw);
    let msg: ClientMessage;
    try {
      msg = JSON.parse(rawStr) as ClientMessage;
    } catch {
      console.warn(`${LOG_PREFIX} [${connId}] invalid JSON (length=${rawStr.length})`);
      sendJson(socket, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    try {
      switch (msg.type) {
        case 'hello':
          console.log(`${LOG_PREFIX} [${connId}] inbound hello`);
          sendJson(socket, { type: 'hello_ok' });
          return;

        case 'configure': {
          console.log(
            `${LOG_PREFIX} [${connId}] configure provider=${msg.provider} model=${msg.model} storage=${msg.storage} safeToolsOnly=${msg.safeToolsOnly === true} ollamaThink=${msg.ollamaThink !== undefined ? String(msg.ollamaThink) : '(default)'} cwd=${msg.cwd ? truncateForLog(msg.cwd) : '(default)'} userBasePath=${msg.userBasePath ? truncateForLog(msg.userBasePath) : '(default)'} mcpConfigPath=${msg.mcpConfigPath ? truncateForLog(msg.mcpConfigPath) : '(none)'}`
          );
          rejectAllAskPending('reconfigured');
          await destroyAllAgents();
          const stableUserBasePath =
            msg.userBasePath && msg.userBasePath.trim() !== ''
              ? msg.userBasePath
              : join(tmpdir(), `agent-sdk-web-demo-${Date.now()}`);
          state.runtimeConfig = {
            provider: msg.provider,
            model: msg.model,
            temperature: msg.temperature,
            maxTokens: msg.maxTokens,
            storage: msg.storage,
            safeToolsOnly: msg.safeToolsOnly === true,
            memory: msg.memory,
            contextManagement: msg.contextManagement !== false,
            mcpConfigPath: msg.mcpConfigPath,
            cwd: msg.cwd,
            userBasePath: stableUserBasePath,
            ollamaThink: msg.ollamaThink
          };
          const { agent, warnings } = await buildAgent({ ...state.runtimeConfig, askUserQuestion });
          const sessionId = agent.getSessionManager().createSession();
          state.agentsBySession.set(sessionId, agent);
          state.activeSessionId = sessionId;
          console.log(
            `${LOG_PREFIX} [${connId}] ready sessionId=${sessionId.slice(0, 8)}… warnings=${warnings.length}`
          );
          sendJson(socket, {
            type: 'ready',
            warnings: warnings.length ? warnings : undefined,
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
          // Ensure old session streaming/tools execution is terminated before switching.
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
            console.log(`${LOG_PREFIX} [${connId}] sessions:resume ok (existing runtime)`);
            sendJson(socket, { type: 'ready', sessionId: msg.sessionId });
            return;
          }
          const agent = await createConfiguredAgent();
          try {
            await agent.getSessionManager().resumeSession(msg.sessionId);
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
            // Bind this runtime to the requested session id for future parallel requests.
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
              signal: ac.signal
            })) {
              if (event.type === 'text_delta') {
                finalText += event.content;
              }
              if (event.type === 'end' && event.usage) {
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
      console.error(`${LOG_PREFIX} [${connId}] handler error:`, message, e instanceof Error ? e.stack : '');
      sendJson(socket, { type: 'error', message, detail: e instanceof Error ? e.stack : undefined });
    }
  });

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
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[web-demo] 端口 ${PORT} 已被占用。请先结束占用进程，或设置环境变量 PORT 使用其他端口。\n` +
        `  查看占用: netstat -ano | findstr :${PORT}\n` +
        `  结束进程: taskkill /PID <上列最后一列> /F`
    );
  } else {
    console.error('[web-demo] HTTP server error:', err);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[web-demo] cwd ${WEB_DEMO_ROOT}`);
  console.log(
    `[web-demo] listening on http://127.0.0.1:${PORT}${PROD ? ' (serving static)' : ' (WebSocket /ws only)'}`
  );
});
