import { statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { AskUserQuestionAnswer } from '@ddlqhd/agent-sdk';
import { normalizeHttpBaseUrl } from '../utils/http-base-url.js';
import type { ClientMessage, ModelProvider } from './shared/ws-protocol.js';

/** Messages that must run even while a chat stream is occupying the serial queue. */
export function isImmediateClientMessage(type: ClientMessage['type']): boolean {
  return type === 'cancel' || type === 'ask_user_question_reply';
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);
const MODEL_PROVIDERS = new Set<ModelProvider>(['openai', 'anthropic', 'ollama']);

export function isLoopbackListenHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
}

export function assertLoopbackBind(host: string, port: number, allowRemote: boolean): void {
  if (!isLoopbackListenHost(host) && !allowRemote) {
    throw new Error(
      `Refusing to bind ${host}:${port}. Default is loopback-only. Pass --allow-remote to expose the agent (tools + API keys) on this interface.`
    );
  }
}

/**
 * Whether a browser Origin may open `/ws` when `--allow-remote` is off.
 * Missing Origin is treated as a non-browser client and allowed only on loopback.
 */
export function isAllowedWsOrigin(
  origin: string | undefined,
  listenHost: string,
  listenPort: number,
  allowRemote: boolean
): boolean {
  if (allowRemote) return true;
  if (!origin || !origin.trim()) {
    return isLoopbackListenHost(listenHost);
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const hostname = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTNAMES.has(hostname)) return false;
  const port =
    url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  return Number.isInteger(port) && port === listenPort;
}

export function parseListenPort(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid --port: ${value}`);
  }
  return n;
}

export function resolveListenPort(
  optionPort: number | undefined,
  envPort: string | undefined
): number {
  if (optionPort !== undefined) return optionPort;
  if (envPort !== undefined && envPort.trim() !== '') {
    return parseListenPort(envPort.trim());
  }
  return 3001;
}

/**
 * Resolve a URL path under `clientDist`. Returns null on traversal, bad encoding, or non-files.
 */
export function resolveStaticFile(clientDist: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent((urlPath.split('?')[0] || '/') || '/');
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const root = resolve(clientDist);
  const resolved = resolve(root, rel);
  const relToRoot = relative(root, resolved);
  if (relToRoot.startsWith('..') || isAbsolute(relToRoot)) return null;
  try {
    if (!statSync(resolved).isFile()) return null;
  } catch {
    return null;
  }
  return resolved;
}

export type ParseClientMessageResult =
  | { ok: true; msg: ClientMessage }
  | { ok: false; error: string };

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function asOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** `undefined` means the field was omitted. `null` means explicitly cleared. */
function parseConfigureBaseUrl(
  value: unknown
): { ok: true; baseUrl?: string | null } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  if (value === null) return { ok: true, baseUrl: null };
  if (typeof value !== 'string') return { ok: false, error: 'configure: invalid baseUrl' };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, baseUrl: null };
  const normalized = normalizeHttpBaseUrl(trimmed);
  if (!normalized) return { ok: false, error: 'configure: invalid baseUrl' };
  return { ok: true, baseUrl: normalized };
}

/** `undefined` means the field was omitted. `null` means explicitly cleared. */
function parseConfigureApiKey(
  value: unknown
): { ok: true; apiKey?: string | null } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  if (value === null) return { ok: true, apiKey: null };
  if (typeof value !== 'string') return { ok: false, error: 'configure: invalid apiKey' };
  const trimmed = value.trim();
  return { ok: true, apiKey: trimmed || null };
}

/**
 * Narrow a parsed JSON value to {@link ClientMessage}. Rejects unknown types and missing required fields.
 */
export function parseClientMessage(raw: unknown): ParseClientMessageResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Invalid message' };
  }
  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== 'string') {
    return { ok: false, error: 'Unknown message type' };
  }

  switch (type) {
    case 'hello':
      return {
        ok: true,
        msg: {
          type: 'hello',
          ...(asOptionalString(obj.clientVersion) ? { clientVersion: obj.clientVersion as string } : {})
        }
      };
    case 'configure': {
      if (typeof obj.provider !== 'string' || !MODEL_PROVIDERS.has(obj.provider as ModelProvider)) {
        return { ok: false, error: 'configure: invalid provider' };
      }
      if (typeof obj.model !== 'string' || !obj.model.trim()) {
        return { ok: false, error: 'configure: model is required' };
      }
      if (obj.storage !== 'memory' && obj.storage !== 'jsonl') {
        return { ok: false, error: 'configure: invalid storage' };
      }
      const thinkingLevel = obj.thinkingLevel;
      if (
        thinkingLevel !== undefined &&
        thinkingLevel !== 'low' &&
        thinkingLevel !== 'medium' &&
        thinkingLevel !== 'high'
      ) {
        return { ok: false, error: 'configure: invalid thinkingLevel' };
      }
      const baseUrl = parseConfigureBaseUrl(obj.baseUrl);
      if (!baseUrl.ok) return baseUrl;
      const apiKey = parseConfigureApiKey(obj.apiKey);
      if (!apiKey.ok) return apiKey;
      return {
        ok: true,
        msg: {
          type: 'configure',
          provider: obj.provider as ModelProvider,
          model: obj.model,
          storage: obj.storage,
          ...(baseUrl.baseUrl !== undefined ? { baseUrl: baseUrl.baseUrl } : {}),
          ...(apiKey.apiKey !== undefined ? { apiKey: apiKey.apiKey } : {}),
          ...(asOptionalFiniteNumber(obj.temperature) !== undefined
            ? { temperature: obj.temperature as number }
            : {}),
          ...(asOptionalFiniteNumber(obj.contextLength) !== undefined
            ? { contextLength: obj.contextLength as number }
            : {}),
          ...(obj.safeToolsOnly === true ? { safeToolsOnly: true } : {}),
          ...(typeof obj.memory === 'boolean' ? { memory: obj.memory } : {}),
          ...(typeof obj.contextManagement === 'boolean'
            ? { contextManagement: obj.contextManagement }
            : {}),
          ...(typeof obj.thinking === 'boolean' ? { thinking: obj.thinking } : {}),
          ...(thinkingLevel === 'low' || thinkingLevel === 'medium' || thinkingLevel === 'high'
            ? { thinkingLevel }
            : {}),
          ...(asOptionalString(obj.mcpConfigPath) ? { mcpConfigPath: obj.mcpConfigPath as string } : {}),
          ...(asOptionalString(obj.cwd) ? { cwd: obj.cwd as string } : {}),
          ...(asOptionalString(obj.userBasePath) ? { userBasePath: obj.userBasePath as string } : {}),
          ...(obj.persist === true ? { persist: true } : {})
        }
      };
    }
    case 'chat':
    case 'chat_run': {
      if (typeof obj.text !== 'string' || typeof obj.requestId !== 'string' || !obj.requestId) {
        return { ok: false, error: `${type}: text and requestId are required` };
      }
      return {
        ok: true,
        msg: {
          type,
          text: obj.text,
          requestId: obj.requestId,
          ...(asOptionalString(obj.sessionId) ? { sessionId: obj.sessionId as string } : {}),
          ...(obj.forkSession === true ? { forkSession: true } : {})
        }
      };
    }
    case 'cancel':
      if (typeof obj.requestId !== 'string' || !obj.requestId) {
        return { ok: false, error: 'cancel: requestId is required' };
      }
      return { ok: true, msg: { type: 'cancel', requestId: obj.requestId } };
    case 'sessions:list':
      return { ok: true, msg: { type: 'sessions:list' } };
    case 'sessions:new':
      return {
        ok: true,
        msg: {
          type: 'sessions:new',
          ...(asOptionalString(obj.sessionId) ? { sessionId: obj.sessionId as string } : {})
        }
      };
    case 'sessions:resume':
      if (typeof obj.sessionId !== 'string' || !obj.sessionId) {
        return { ok: false, error: 'sessions:resume: sessionId is required' };
      }
      return { ok: true, msg: { type: 'sessions:resume', sessionId: obj.sessionId } };
    case 'sessions:delete':
      if (typeof obj.sessionId !== 'string' || !obj.sessionId) {
        return { ok: false, error: 'sessions:delete: sessionId is required' };
      }
      return { ok: true, msg: { type: 'sessions:delete', sessionId: obj.sessionId } };
    case 'sessions:checkpoints':
      return {
        ok: true,
        msg: {
          type: 'sessions:checkpoints',
          ...(asOptionalString(obj.sessionId) ? { sessionId: obj.sessionId as string } : {})
        }
      };
    case 'sessions:rewind': {
      const checkpointId = asOptionalString(obj.checkpointId);
      const userTurnIndex = asOptionalFiniteNumber(obj.userTurnIndex);
      return {
        ok: true,
        msg: {
          type: 'sessions:rewind',
          ...(asOptionalString(obj.sessionId) ? { sessionId: obj.sessionId as string } : {}),
          ...(checkpointId ? { checkpointId } : {}),
          ...(userTurnIndex !== undefined ? { userTurnIndex } : {})
        }
      };
    }
    case 'sessions:fork': {
      const checkpointId = asOptionalString(obj.checkpointId);
      const userTurnIndex = asOptionalFiniteNumber(obj.userTurnIndex);
      return {
        ok: true,
        msg: {
          type: 'sessions:fork',
          ...(asOptionalString(obj.sessionId) ? { sessionId: obj.sessionId as string } : {}),
          ...(checkpointId ? { checkpointId } : {}),
          ...(userTurnIndex !== undefined ? { userTurnIndex } : {}),
          ...(asOptionalString(obj.newSessionId) ? { newSessionId: obj.newSessionId as string } : {})
        }
      };
    }
    case 'ask_user_question_reply':
      if (typeof obj.requestId !== 'string' || !obj.requestId) {
        return { ok: false, error: 'ask_user_question_reply: requestId is required' };
      }
      if (!Array.isArray(obj.answers)) {
        return { ok: false, error: 'ask_user_question_reply: answers is required' };
      }
      return {
        ok: true,
        msg: {
          type: 'ask_user_question_reply',
          requestId: obj.requestId,
          answers: obj.answers as AskUserQuestionAnswer[]
        }
      };
    default:
      return { ok: false, error: 'Unknown message type' };
  }
}
