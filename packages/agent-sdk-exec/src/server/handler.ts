import { randomUUID } from 'node:crypto';
import {
  decodeBytes,
  encodeBytes,
  METHODS,
  PROTOCOL_VERSION,
  type EnvironmentInfo,
  type InitializeParams,
  type JsonRpcRequest
} from '../protocol.js';
import { ExecAuthError, ExecError, EXEC_NOT_FOUND, EXEC_NOT_INITIALIZED, JSON_RPC_INVALID_PARAMS } from '../errors.js';
import type { Environment, ProcessHandle } from '../environment.js';
import { PACKAGE_VERSION } from '../version.js';
import { getExecutorShellPath } from '../local/shell-path.js';

export interface ExecSession {
  id: string;
  initialized: boolean;
  environment: Environment;
  processes: Map<string, ProcessHandle>;
}

export interface HandlerContext {
  token?: string;
  environment: Environment;
  session: ExecSession;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExecError('params must be an object', JSON_RPC_INVALID_PARAMS);
  }
  return value as Record<string, unknown>;
}

function str(obj: Record<string, unknown>, key: string, required = false): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (required) {
      throw new ExecError(`Missing param: ${key}`, JSON_RPC_INVALID_PARAMS);
    }
    return undefined;
  }
  if (typeof v !== 'string') {
    throw new ExecError(`Param ${key} must be a string`, JSON_RPC_INVALID_PARAMS);
  }
  return v;
}

function num(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ExecError(`Param ${key} must be a number`, JSON_RPC_INVALID_PARAMS);
  }
  return v;
}

function bool(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') {
    throw new ExecError(`Param ${key} must be a boolean`, JSON_RPC_INVALID_PARAMS);
  }
  return v;
}

export function environmentInfoFrom(env: Environment): EnvironmentInfo {
  const shellPath = env.info.shellPath ?? getExecutorShellPath();
  const name = shellPath.split(/[/\\]/).pop()?.replace(/\.exe$/i, '');
  return {
    shell: { name, path: shellPath },
    executorVersion: PACKAGE_VERSION,
    cwd: env.info.cwd,
    platformOs: env.info.platformOs,
    workspaceRoot: env.info.workspaceRoot
  };
}

export async function handleRequest(
  ctx: HandlerContext,
  request: JsonRpcRequest,
  authToken?: string | null
): Promise<unknown> {
  if (request.method === METHODS.initialize) {
    const params = asRecord(request.params ?? {});
    const token = str(params, 'token') ?? authToken ?? undefined;
    if (ctx.token && token !== ctx.token) {
      throw new ExecAuthError();
    }
    const init = params as unknown as InitializeParams;
    if (!init.clientName) {
      throw new ExecError('clientName is required', JSON_RPC_INVALID_PARAMS);
    }
    ctx.session.initialized = true;
    ctx.session.id = randomUUID();
    return {
      sessionId: ctx.session.id,
      protocolVersion: PROTOCOL_VERSION,
      environmentInfo: environmentInfoFrom(ctx.environment)
    };
  }

  if (!ctx.session.initialized && request.method !== METHODS.initialized) {
    throw new ExecError('Session is not initialized', EXEC_NOT_INITIALIZED);
  }

  if (request.method === METHODS.initialized) {
    return {};
  }

  const env = ctx.environment;
  const params = request.params === undefined ? {} : asRecord(request.params);

  switch (request.method) {
    case METHODS.environmentInfo:
      return environmentInfoFrom(env);
    case METHODS.environmentStatus:
      return { status: 'ready' };
    case METHODS.fsGetMetadata: {
      const path = str(params, 'path', true)!;
      return env.fs.stat(path);
    }
    case METHODS.fsReadFile: {
      const path = str(params, 'path', true)!;
      const data = await env.fs.readFile(path, {
        offset: num(params, 'offset'),
        length: num(params, 'length')
      });
      return { data: encodeBytes(data) };
    }
    case METHODS.fsWriteFile: {
      const path = str(params, 'path', true)!;
      const data = str(params, 'data', true)!;
      await env.fs.writeFile(path, decodeBytes(data), { mkdir: bool(params, 'mkdir') });
      return {};
    }
    case METHODS.fsCreateDirectory: {
      await env.fs.mkdir(str(params, 'path', true)!, { recursive: bool(params, 'recursive') });
      return {};
    }
    case METHODS.fsCanonicalize:
      return { path: await env.fs.canonicalize(str(params, 'path', true)!) };
    case METHODS.fsReadDirectory:
      return { entries: await env.fs.readDir(str(params, 'path', true)!) };
    case METHODS.fsRemove: {
      await env.fs.remove(str(params, 'path', true)!, { recursive: bool(params, 'recursive') });
      return {};
    }
    case METHODS.fsCopy: {
      await env.fs.copy(str(params, 'src', true)!, str(params, 'dest', true)!);
      return {};
    }
    case METHODS.fsReadText: {
      const path = str(params, 'path', true)!;
      return env.fs.readText(path, {
        encoding: str(params, 'encoding'),
        lineOffset: num(params, 'lineOffset'),
        lineLimit: num(params, 'lineLimit'),
        maxBytes: num(params, 'maxBytes'),
        maxLineLength: num(params, 'maxLineLength')
      });
    }
    case METHODS.fsWriteText: {
      await env.fs.writeText(str(params, 'path', true)!, str(params, 'text', true)!, {
        encoding: str(params, 'encoding'),
        mkdir: bool(params, 'mkdir')
      });
      return {};
    }
    case METHODS.fsGlob: {
      const pattern = str(params, 'pattern', true)!;
      const cwd = str(params, 'cwd', true)!;
      return { matches: await env.fs.glob(pattern, { cwd, includeDotfiles: bool(params, 'includeDotfiles') }) };
    }
    case METHODS.fsSearch: {
      return env.fs.search({
        pattern: str(params, 'pattern', true)!,
        path: str(params, 'path', true)!,
        projectDir: str(params, 'projectDir'),
        glob: str(params, 'glob'),
        caseInsensitive: bool(params, 'caseInsensitive'),
        context: num(params, 'context'),
        headLimit: num(params, 'headLimit')
      });
    }
    case METHODS.httpRequest: {
      return env.http.request({
        url: str(params, 'url', true)!,
        method: str(params, 'method'),
        timeoutMs: num(params, 'timeoutMs'),
        maxBytes: num(params, 'maxBytes'),
        maxRedirects: num(params, 'maxRedirects'),
        headers: (params.headers as Record<string, string> | undefined) ?? undefined
      });
    }
    case METHODS.processStart: {
      const handle = await env.process.start({
        command: str(params, 'command', true)!,
        cwd: str(params, 'cwd'),
        env: (params.env as Record<string, string> | undefined) ?? undefined,
        shellPath: str(params, 'shellPath'),
        background: bool(params, 'background'),
        title: str(params, 'title'),
        maxRingChars: num(params, 'maxRingChars'),
        removeJobOnExit: bool(params, 'removeJobOnExit')
      });
      ctx.session.processes.set(handle.id, handle);
      return {
        processId: handle.id,
        pid: handle.pid,
        command: handle.command,
        cwd: handle.cwd,
        title: handle.title,
        status: handle.status,
        logFilePath: handle.logFilePath
      };
    }
    case METHODS.processRead: {
      const id = str(params, 'processId', true)!;
      const handle = ctx.session.processes.get(id) ?? (await env.process.getJob(id));
      if (!handle) {
        throw new ExecError(`Unknown process: ${id}`, EXEC_NOT_FOUND);
      }
      return handle.read({
        stream: str(params, 'stream') as 'all' | 'stdout' | 'stderr' | undefined,
        sinceCursor: num(params, 'sinceCursor'),
        sinceCursorStdout: num(params, 'sinceCursorStdout'),
        sinceCursorStderr: num(params, 'sinceCursorStderr'),
        tailChars: num(params, 'tailChars'),
        limitChars: num(params, 'limitChars'),
        waitMs: num(params, 'waitMs'),
        pattern: str(params, 'pattern')
      });
    }
    case METHODS.processWrite:
      throw new ExecError('process/write is not supported in this protocol version', JSON_RPC_INVALID_PARAMS);
    case METHODS.processSignal: {
      const id = str(params, 'processId', true)!;
      const handle = ctx.session.processes.get(id) ?? (await env.process.getJob(id));
      if (!handle) {
        throw new ExecError(`Unknown process: ${id}`, EXEC_NOT_FOUND);
      }
      await handle.signal((str(params, 'signal') as NodeJS.Signals | undefined) ?? 'SIGTERM');
      return {};
    }
    case METHODS.processTerminate: {
      const id = str(params, 'processId', true)!;
      const handle = ctx.session.processes.get(id) ?? (await env.process.getJob(id));
      if (!handle) {
        return { ok: false, message: `No job "${id}"` };
      }
      const result = await handle.terminate({ killDelayMs: num(params, 'killDelayMs') });
      ctx.session.processes.delete(id);
      return result;
    }
    case METHODS.processWait: {
      const id = str(params, 'processId', true)!;
      const handle = ctx.session.processes.get(id) ?? (await env.process.getJob(id));
      if (!handle) {
        throw new ExecError(`Unknown process: ${id}`, EXEC_NOT_FOUND);
      }
      return handle.wait({
        timeoutMs: num(params, 'timeoutMs'),
        maxOutputBytes: num(params, 'maxOutputBytes')
      });
    }
    case METHODS.processList:
      return { jobs: await env.process.listJobs() };
    default:
      throw new ExecError(`Unknown method: ${request.method}`, JSON_RPC_INVALID_PARAMS);
  }
}

export async function closeSession(session: ExecSession): Promise<void> {
  for (const handle of session.processes.values()) {
    try {
      await handle.terminate({ killDelayMs: 500 });
    } catch {
      // ignore
    }
  }
  session.processes.clear();
}
