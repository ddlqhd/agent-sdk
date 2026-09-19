import { METHODS } from '../protocol.js';

export type ExecServerLogEventName =
  | 'connection'
  | 'request'
  | 'notification'
  | 'disconnect'
  | 'error';

export interface ExecServerLogEvent {
  event: ExecServerLogEventName;
  sessionId: string;
  method?: string;
  durationMs?: number;
  ok?: boolean;
  error?: string;
  remoteAddress?: string;
  detail?: Record<string, unknown>;
  timestamp?: string;
}

export type ExecServerLogFn = (entry: ExecServerLogEvent) => void;

const MAX_VALUE_CHARS = 160;

function clip(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (value.length <= MAX_VALUE_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_VALUE_CHARS)}…`;
}

function pathDetail(params: Record<string, unknown>): Record<string, unknown> | undefined {
  const path = clip(params.path);
  return path ? { path } : undefined;
}

/**
 * Safe RPC param summary: paths/commands/urls only. Never include tokens or file bodies.
 */
export function summarizeRpcParams(
  method: string,
  params: unknown
): Record<string, unknown> | undefined {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return undefined;
  }
  const p = params as Record<string, unknown>;
  switch (method) {
    case METHODS.initialize: {
      const detail: Record<string, unknown> = {};
      if (typeof p.clientName === 'string') {
        detail.clientName = p.clientName;
      }
      if (typeof p.protocolVersion === 'string') {
        detail.protocolVersion = p.protocolVersion;
      }
      return Object.keys(detail).length > 0 ? detail : undefined;
    }
    case METHODS.fsReadFile:
    case METHODS.fsReadText:
    case METHODS.fsGetMetadata:
    case METHODS.fsCanonicalize:
    case METHODS.fsReadDirectory:
    case METHODS.fsRemove:
    case METHODS.fsCreateDirectory:
      return pathDetail(p);
    case METHODS.fsWriteFile:
      return {
        ...pathDetail(p),
        ...(typeof p.data === 'string' ? { dataChars: p.data.length } : {})
      };
    case METHODS.fsWriteText:
      return {
        ...pathDetail(p),
        ...(typeof p.text === 'string' ? { textChars: p.text.length } : {})
      };
    case METHODS.fsCopy:
      return { src: clip(p.src), dest: clip(p.dest) };
    case METHODS.fsGlob:
      return { pattern: clip(p.pattern), cwd: clip(p.cwd) };
    case METHODS.fsSearch:
      return { pattern: clip(p.pattern), path: clip(p.path) };
    case METHODS.processStart:
      return {
        command: clip(p.command),
        cwd: clip(p.cwd),
        ...(typeof p.background === 'boolean' ? { background: p.background } : {})
      };
    case METHODS.processRead:
    case METHODS.processWait:
    case METHODS.processSignal:
    case METHODS.processTerminate:
      return typeof p.processId === 'string' ? { processId: p.processId } : undefined;
    case METHODS.httpRequest:
      return {
        httpMethod: typeof p.method === 'string' ? p.method : 'GET',
        url: clip(p.url)
      };
    default:
      return undefined;
  }
}

function formatField(value: unknown): string {
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  const text = String(value);
  if (text === '') {
    return '""';
  }
  if (/[\s="]/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

export function formatExecServerLogLine(entry: ExecServerLogEvent): string {
  const ts = entry.timestamp ?? new Date().toISOString();
  const parts = [`[exec-server]`, `session=${entry.sessionId}`, `event=${entry.event}`];
  if (entry.remoteAddress) {
    parts.push(`remote=${entry.remoteAddress}`);
  }
  if (entry.method) {
    parts.push(`method=${entry.method}`);
  }
  if (entry.ok !== undefined) {
    parts.push(entry.ok ? 'ok' : 'error');
  }
  if (entry.durationMs !== undefined) {
    parts.push(`${entry.durationMs}ms`);
  }
  if (entry.error) {
    parts.push(`error=${formatField(entry.error)}`);
  }
  if (entry.detail) {
    for (const [key, value] of Object.entries(entry.detail)) {
      if (value === undefined || value === null) {
        continue;
      }
      parts.push(`${key}=${formatField(value)}`);
    }
  }
  return `${ts} ${parts.join(' ')}`;
}

export function printExecServerLog(entry: ExecServerLogEvent): void {
  process.stdout.write(`${formatExecServerLogLine(entry)}\n`);
}
