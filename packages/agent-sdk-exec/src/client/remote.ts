import WebSocket from 'ws';
import {
  decodeBytes,
  encodeBytes,
  METHODS,
  PROTOCOL_VERSION,
  isJsonRpcFailure,
  isJsonRpcSuccess,
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
  type EnvironmentInfo,
  type JsonRpcMessage
} from '../protocol.js';
import { ExecError } from '../errors.js';
import type {
  DirEntry,
  Environment,
  FileStat,
  FileSystem,
  GlobMatch,
  GlobOptions,
  HttpRequest,
  HttpResponse,
  HttpRuntime,
  ProcessHandle,
  ProcessListItem,
  ProcessReadOptions,
  ProcessReadResult,
  ProcessRuntime,
  ProcessStartRequest,
  ProcessTerminateResult,
  ProcessWaitResult,
  SkillListItem,
  ReadFileOptions,
  ReadTextOptions,
  ReadTextResult,
  RemoteEnvironmentConfig,
  SearchOptions,
  SearchResult,
  WriteTextOptions
} from '../environment.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class ExecRpcClient {
  private ws: WebSocket | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private environmentInfo: EnvironmentInfo | undefined;

  constructor(private readonly config: RemoteEnvironmentConfig) {}

  get info(): EnvironmentInfo | undefined {
    return this.environmentInfo;
  }

  async connect(): Promise<EnvironmentInfo> {
    const timeout = this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const headers: Record<string, string> = {};
    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    const ws = new WebSocket(this.config.url, { headers });
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Timed out connecting to exec-server ${this.config.url}`));
      }, timeout);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString();
      let msg: JsonRpcMessage;
      try {
        msg = parseJsonRpcMessage(raw);
      } catch {
        return;
      }
      if (isJsonRpcSuccess(msg) || isJsonRpcFailure(msg)) {
        const id = typeof msg.id === 'number' ? msg.id : Number(msg.id);
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        if (isJsonRpcFailure(msg)) {
          pending.reject(new ExecError(msg.error.message, msg.error.code, msg.error.data));
        } else {
          pending.resolve(msg.result);
        }
      }
    });

    ws.on('close', () => {
      for (const [, p] of this.pending) {
        p.reject(new Error('exec-server connection closed'));
      }
      this.pending.clear();
    });

    const result = (await this.request(METHODS.initialize, {
      clientName: this.config.clientName ?? 'agent-sdk',
      protocolVersion: PROTOCOL_VERSION,
      token: this.config.token
    })) as { environmentInfo: EnvironmentInfo };
    this.environmentInfo = result.environmentInfo;
    await this.notify(METHODS.initialized, {});
    return result.environmentInfo;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('exec-server is not connected');
    }
    const id = this.nextId++;
    const payload = serializeJsonRpcMessage({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('exec-server is not connected');
    }
    this.ws.send(serializeJsonRpcMessage({ jsonrpc: '2.0', method, params }));
  }

  async close(): Promise<void> {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = undefined;
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close();
      setTimeout(resolve, 500);
    });
  }
}

class RemoteFileSystem implements FileSystem {
  constructor(private readonly rpc: ExecRpcClient) {}

  async stat(path: string): Promise<FileStat> {
    return (await this.rpc.request(METHODS.fsGetMetadata, { path })) as FileStat;
  }

  async readFile(path: string, opts?: ReadFileOptions): Promise<Uint8Array> {
    const result = (await this.rpc.request(METHODS.fsReadFile, { path, ...opts })) as { data: string };
    return decodeBytes(result.data);
  }

  async writeFile(path: string, data: Uint8Array, opts?: { mkdir?: boolean }): Promise<void> {
    await this.rpc.request(METHODS.fsWriteFile, { path, data: encodeBytes(data), mkdir: opts?.mkdir });
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await this.rpc.request(METHODS.fsCreateDirectory, { path, recursive: opts?.recursive });
  }

  async readDir(path: string): Promise<DirEntry[]> {
    const result = (await this.rpc.request(METHODS.fsReadDirectory, { path })) as { entries: DirEntry[] };
    return result.entries;
  }

  async canonicalize(path: string): Promise<string> {
    const result = (await this.rpc.request(METHODS.fsCanonicalize, { path })) as { path: string };
    return result.path;
  }

  async remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await this.rpc.request(METHODS.fsRemove, { path, recursive: opts?.recursive });
  }

  async copy(src: string, dest: string): Promise<void> {
    await this.rpc.request(METHODS.fsCopy, { src, dest });
  }

  async readText(path: string, opts?: ReadTextOptions): Promise<ReadTextResult> {
    return (await this.rpc.request(METHODS.fsReadText, { path, ...opts })) as ReadTextResult;
  }

  async writeText(path: string, text: string, opts?: WriteTextOptions): Promise<void> {
    await this.rpc.request(METHODS.fsWriteText, { path, text, ...opts });
  }

  async glob(pattern: string, opts: GlobOptions): Promise<GlobMatch[]> {
    const result = (await this.rpc.request(METHODS.fsGlob, {
      pattern,
      cwd: opts.cwd,
      includeDotfiles: opts.includeDotfiles
    })) as { matches: GlobMatch[] };
    return result.matches;
  }

  async search(opts: SearchOptions): Promise<SearchResult> {
    return (await this.rpc.request(METHODS.fsSearch, opts)) as SearchResult;
  }
}

class RemoteProcessRuntime implements ProcessRuntime {
  constructor(private readonly rpc: ExecRpcClient) {}

  async start(req: ProcessStartRequest): Promise<ProcessHandle> {
    const started = (await this.rpc.request(METHODS.processStart, req)) as {
      processId: string;
      pid?: number;
      command: string;
      cwd?: string;
      title?: string;
      status: ProcessListItem['status'];
      logFilePath?: string;
    };
    return this.wrap(started);
  }

  async listJobs(): Promise<ProcessListItem[]> {
    const result = (await this.rpc.request(METHODS.processList, {})) as { jobs: ProcessListItem[] };
    return result.jobs;
  }

  async getJob(id: string): Promise<ProcessHandle | undefined> {
    const jobs = await this.listJobs();
    const row = jobs.find((j) => j.id === id);
    if (!row) return undefined;
    return this.wrap({
      processId: row.id,
      pid: row.pid,
      command: row.command,
      cwd: row.cwd,
      title: row.title,
      status: row.status,
      logFilePath: row.logFile
    });
  }

  private wrap(started: {
    processId: string;
    pid?: number;
    command: string;
    cwd?: string;
    title?: string;
    status: ProcessListItem['status'];
    logFilePath?: string;
  }): ProcessHandle {
    const rpc = this.rpc;
    return {
      id: started.processId,
      pid: started.pid,
      command: started.command,
      cwd: started.cwd,
      title: started.title,
      status: started.status,
      logFilePath: started.logFilePath,
      async wait(opts): Promise<ProcessWaitResult> {
        return (await rpc.request(METHODS.processWait, {
          processId: started.processId,
          timeoutMs: opts?.timeoutMs,
          maxOutputBytes: opts?.maxOutputBytes
        })) as ProcessWaitResult;
      },
      async read(opts?: ProcessReadOptions): Promise<ProcessReadResult> {
        return (await rpc.request(METHODS.processRead, {
          processId: started.processId,
          ...opts
        })) as ProcessReadResult;
      },
      async write(data: Uint8Array): Promise<void> {
        await rpc.request(METHODS.processWrite, {
          processId: started.processId,
          data: encodeBytes(data)
        });
      },
      async signal(sig?: NodeJS.Signals): Promise<void> {
        await rpc.request(METHODS.processSignal, { processId: started.processId, signal: sig });
      },
      async terminate(opts?: { killDelayMs?: number }): Promise<ProcessTerminateResult> {
        return (await rpc.request(METHODS.processTerminate, {
          processId: started.processId,
          killDelayMs: opts?.killDelayMs
        })) as ProcessTerminateResult;
      }
    };
  }
}

class RemoteHttpRuntime implements HttpRuntime {
  constructor(private readonly rpc: ExecRpcClient) {}

  async request(req: HttpRequest): Promise<HttpResponse> {
    return (await this.rpc.request(METHODS.httpRequest, req)) as HttpResponse;
  }
}

export async function connectRemoteEnvironment(config: RemoteEnvironmentConfig): Promise<Environment> {
  const rpc = new ExecRpcClient(config);
  const info = await rpc.connect();
  return {
    id: `remote-${info.cwd}`,
    kind: 'remote',
    info: {
      cwd: config.cwd ?? info.cwd,
      platformOs: info.platformOs,
      shellPath: info.shell.path,
      workspaceRoot: info.workspaceRoot,
      userHome: info.userHome,
      remoteUrl: config.url
    },
    fs: new RemoteFileSystem(rpc),
    process: new RemoteProcessRuntime(rpc),
    http: new RemoteHttpRuntime(rpc),
    listSkills: async (opts) => {
      const result = (await rpc.request(METHODS.skillsList, {
        workspaceSkillsPath: opts?.workspaceSkillsPath
      })) as { skills: SkillListItem[] };
      return result.skills;
    },
    close: () => rpc.close()
  };
}

export function createFailedEnvironment(error: Error): Environment {
  const fail = async (): Promise<never> => {
    throw error;
  };
  const fs = {
    stat: fail,
    readFile: fail,
    writeFile: fail,
    mkdir: fail,
    readDir: fail,
    canonicalize: fail,
    remove: fail,
    copy: fail,
    readText: fail,
    writeText: fail,
    glob: fail,
    search: fail
  } as unknown as FileSystem;
  return {
    id: 'failed',
    kind: 'failed',
    info: { cwd: process.cwd(), platformOs: process.platform },
    fs,
    process: {
      start: fail,
      listJobs: fail,
      getJob: fail
    },
    http: { request: fail },
    listSkills: fail
  };
}
