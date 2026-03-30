import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import type { Agent, SessionInfo } from 'agent-sdk';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import type { ClientMessage, ServerMessage } from '../shared/ws-protocol.js';
import { applySafeToolsAndCalculator, buildAgent } from './agent-factory.js';
import { CLIENT_DIST, WEB_DEMO_ROOT } from './paths.js';
import { serializeStreamEvent } from './serialize-event.js';

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
  agent: Agent | null;
  abortByRequest: Map<string, AbortController>;
}

wss.on('connection', (socket: WebSocket) => {
  const state: ConnState = { agent: null, abortByRequest: new Map() };

  socket.on('message', async (raw: RawData) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      sendJson(socket, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    try {
      switch (msg.type) {
        case 'hello':
          sendJson(socket, { type: 'hello_ok' });
          return;

        case 'configure': {
          if (state.agent) {
            await state.agent.destroy();
            state.agent = null;
          }
          const { agent, warnings } = buildAgent({
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
            userBasePath: msg.userBasePath
          });
          await agent.waitForInit();
          await applySafeToolsAndCalculator(agent, msg.safeToolsOnly === true);
          state.agent = agent;
          sendJson(socket, {
            type: 'ready',
            warnings: warnings.length ? warnings : undefined,
            sessionId: agent.getSessionManager().sessionId
          });
          return;
        }

        case 'sessions:list': {
          if (!state.agent) {
            sendJson(socket, { type: 'error', message: 'Configure the agent first.' });
            return;
          }
          const sessions = await state.agent.getSessionManager().listSessions();
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
          if (!state.agent) {
            sendJson(socket, { type: 'error', message: 'Configure the agent first.' });
            return;
          }
          const id = state.agent.getSessionManager().createSession(msg.sessionId);
          sendJson(socket, { type: 'sessions:new', sessionId: id });
          return;
        }

        case 'sessions:resume': {
          if (!state.agent) {
            sendJson(socket, { type: 'error', message: 'Configure the agent first.' });
            return;
          }
          try {
            await state.agent.getSessionManager().resumeSession(msg.sessionId);
          } catch {
            sendJson(socket, {
              type: 'error',
              message: `Session not found: ${msg.sessionId}`
            });
            return;
          }
          sendJson(socket, { type: 'ready', sessionId: msg.sessionId });
          return;
        }

        case 'cancel': {
          const ac = state.abortByRequest.get(msg.requestId);
          ac?.abort();
          return;
        }

        case 'chat':
        case 'chat_run': {
          if (!state.agent) {
            sendJson(socket, { type: 'error', message: 'Configure the agent first.' });
            return;
          }
          const requestId = msg.requestId;
          const ac = new AbortController();
          state.abortByRequest.set(requestId, ac);

          try {
            let finalText = '';
            let lastUsage: Record<string, unknown> | undefined;
            for await (const event of state.agent.stream(msg.text, {
              sessionId: msg.sessionId,
              signal: ac.signal
            })) {
              if (event.type === 'text_delta') {
                finalText += event.content;
              }
              if (event.type === 'end' && event.usage) {
                lastUsage = event.usage as Record<string, unknown>;
              }
              sendJson(socket, { type: 'stream_event', event: serializeStreamEvent(event) });
            }
            const sid = state.agent.getSessionManager().sessionId || '';
            sendJson(socket, {
              type: 'chat_done',
              requestId,
              sessionId: sid,
              finalText,
              usage: lastUsage
            });
          } catch (e) {
            sendJson(socket, {
              type: 'stream_event',
              event: serializeStreamEvent({
                type: 'error',
                error: e instanceof Error ? e : new Error(String(e))
              })
            });
            sendJson(socket, {
              type: 'chat_done',
              requestId,
              sessionId: state.agent.getSessionManager().sessionId || '',
              finalText: ''
            });
          } finally {
            state.abortByRequest.delete(requestId);
          }
          return;
        }

        default:
          sendJson(socket, { type: 'error', message: 'Unknown message type' });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      sendJson(socket, { type: 'error', message, detail: e instanceof Error ? e.stack : undefined });
    }
  });

  socket.on('close', () => {
    void state.agent?.destroy();
    state.agent = null;
    state.abortByRequest.clear();
  });
});

server.listen(PORT, () => {
  console.log(`[web-demo] cwd ${WEB_DEMO_ROOT}`);
  console.log(
    `[web-demo] listening on http://127.0.0.1:${PORT}${PROD ? ' (serving static)' : ' (WebSocket /ws only)'}`
  );
});
