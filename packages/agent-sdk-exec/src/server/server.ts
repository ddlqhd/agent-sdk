import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import type { IncomingMessage } from 'node:http';
import { ExecError, JSON_RPC_INTERNAL_ERROR, JSON_RPC_INVALID_REQUEST } from '../errors.js';
import { createLocalEnvironment } from '../local/environment.js';
import {
  isJsonRpcRequest,
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
  type JsonRpcFailure,
  type JsonRpcSuccess
} from '../protocol.js';
import { closeSession, handleRequest, type ExecSession, type HandlerContext } from './handler.js';
import { summarizeRpcParams, type ExecServerLogFn } from './log.js';

export interface ExecServerOptions {
  host?: string;
  port?: number;
  token?: string;
  cwd?: string;
  /** When set, emit connection / RPC / disconnect events (CLI prints these). */
  log?: ExecServerLogFn;
}

export interface RunningExecServer {
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

function headerToken(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const header = req.headers['x-agent-sdk-exec-token'];
  if (typeof header === 'string') {
    return header;
  }
  return undefined;
}

function send(ws: WebSocket, msg: JsonRpcSuccess | JsonRpcFailure): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(serializeJsonRpcMessage(msg));
  }
}

export async function startExecServer(options: ExecServerOptions = {}): Promise<RunningExecServer> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8787;
  const environment = createLocalEnvironment({ workspaceRoot: options.cwd });
  const log = options.log;

  const wss = new WebSocketServer({ host, port });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const session: ExecSession = {
      id: randomUUID(),
      initialized: false,
      environment,
      processes: new Map()
    };
    const sessionId = session.id;
    const remoteAddress = req.socket.remoteAddress;
    const ctx: HandlerContext = {
      token: options.token,
      environment,
      session
    };
    const authToken = headerToken(req) ?? null;
    log?.({ event: 'connection', sessionId, remoteAddress });

    ws.on('message', (data: RawData) => {
      void (async () => {
        let raw: string;
        if (typeof data === 'string') {
          raw = data;
        } else if (Buffer.isBuffer(data)) {
          raw = data.toString('utf8');
        } else {
          raw = Buffer.from(data as ArrayBuffer).toString('utf8');
        }

        let parsed;
        try {
          parsed = parseJsonRpcMessage(raw);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log?.({ event: 'error', sessionId, error: message });
          send(ws, {
            jsonrpc: '2.0',
            id: null,
            error: {
              code: JSON_RPC_INVALID_REQUEST,
              message
            }
          });
          return;
        }

        if (!isJsonRpcRequest(parsed)) {
          if (parsed && 'method' in parsed && parsed.method === 'initialized') {
            session.initialized = true;
            log?.({
              event: 'notification',
              sessionId,
              method: parsed.method,
              ok: true
            });
          }
          return;
        }

        const startedAt = Date.now();
        const detail = summarizeRpcParams(parsed.method, parsed.params);
        try {
          const result = await handleRequest(ctx, parsed, authToken);
          log?.({
            event: 'request',
            sessionId,
            method: parsed.method,
            ok: true,
            durationMs: Date.now() - startedAt,
            detail
          });
          send(ws, { jsonrpc: '2.0', id: parsed.id, result });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log?.({
            event: 'request',
            sessionId,
            method: parsed.method,
            ok: false,
            durationMs: Date.now() - startedAt,
            error: message,
            detail
          });
          const code = err instanceof ExecError ? err.code : JSON_RPC_INTERNAL_ERROR;
          send(ws, {
            jsonrpc: '2.0',
            id: parsed.id,
            error: {
              code,
              message,
              ...(err instanceof ExecError && err.data !== undefined ? { data: err.data } : {})
            }
          });
        }
      })();
    });

    ws.on('close', () => {
      log?.({ event: 'disconnect', sessionId, remoteAddress });
      void closeSession(session);
    });
  });

  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve());
    wss.once('error', reject);
  });

  const address = wss.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const actualHost = typeof address === 'object' && address ? address.address : host;

  return {
    host: actualHost,
    port: actualPort,
    url: `ws://${actualHost === '::' ? '127.0.0.1' : actualHost}:${actualPort}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await environment.close?.();
    }
  };
}

export function parseListenAddress(listen: string): { host: string; port: number } {
  const trimmed = listen.trim();
  const withoutScheme = trimmed.replace(/^wss?:\/\//, '');
  const [hostPart, portPart] = withoutScheme.split(':');
  if (!portPart) {
    return { host: '127.0.0.1', port: Number.parseInt(hostPart || '8787', 10) };
  }
  const port = Number.parseInt(portPart, 10);
  if (!Number.isFinite(port)) {
    throw new Error(`Invalid listen address: ${listen}`);
  }
  return { host: hostPart || '127.0.0.1', port };
}
