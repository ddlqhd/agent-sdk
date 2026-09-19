export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export interface ReadFileOptions {
  offset?: number;
  length?: number;
}

export interface ReadTextOptions {
  /** Omit or `auto` to detect encoding from a file sample. */
  encoding?: string;
  /** 1-indexed first line to return. */
  lineOffset?: number;
  lineLimit?: number;
  maxBytes?: number;
  maxLineLength?: number;
}

export interface ReadTextResult {
  isFile: boolean;
  size: number;
  encoding: string;
  detectedEncoding?: string;
  /** Full decoded text when line pagination is not requested. */
  text?: string;
  lines: string[];
  startLine: number;
  totalLines: number;
  truncatedByBytes: boolean;
  hasMoreLines: boolean;
  unsupportedEncoding?: string;
}

export interface WriteTextOptions {
  encoding?: string;
  mkdir?: boolean;
}

export interface GlobOptions {
  cwd: string;
  includeDotfiles?: boolean;
}

export interface GlobMatch {
  path: string;
  mtimeMs: number;
}

export interface SearchOptions {
  pattern: string;
  path: string;
  projectDir?: string;
  glob?: string;
  caseInsensitive?: boolean;
  context?: number;
  headLimit?: number;
}

export interface SearchResult {
  ok: boolean;
  content: string;
}

export interface FileSystem {
  stat(path: string): Promise<FileStat>;
  readFile(path: string, opts?: ReadFileOptions): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array, opts?: { mkdir?: boolean }): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  readDir(path: string): Promise<DirEntry[]>;
  canonicalize(path: string): Promise<string>;
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
  copy(src: string, dest: string): Promise<void>;
  readText(path: string, opts?: ReadTextOptions): Promise<ReadTextResult>;
  writeText(path: string, text: string, opts?: WriteTextOptions): Promise<void>;
  glob(pattern: string, opts: GlobOptions): Promise<GlobMatch[]>;
  search(opts: SearchOptions): Promise<SearchResult>;
}

export interface SkillListOptions {
  /** Override `{cwd}/.claude/skills` (maps to `SkillConfig.workspacePath`). */
  workspaceSkillsPath?: string;
}

export type SkillScope = 'user' | 'workspace';

export interface SkillListItem {
  name: string;
  description: string;
  /** Absolute path to SKILL.md on the execution plane. */
  path: string;
  scope: SkillScope;
  argumentHint?: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
}

export interface ProcessStartRequest {
  command: string;
  /** When set, spawn `command` with this argv (no shell). */
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /**
   * When true, `env` is the complete child environment (MCP stdio).
   * Default false: merge `env` on top of the executor `process.env`.
   */
  replaceEnv?: boolean;
  shellPath?: string;
  background?: boolean;
  title?: string;
  maxRingChars?: number;
  removeJobOnExit?: boolean;
  /** Keep stdin open and allow {@link ProcessHandle.write}. Default false. */
  pipeStdin?: boolean;
}

export interface ProcessWaitResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  spawnError?: string;
}

export interface ProcessReadOptions {
  stream?: 'all' | 'stdout' | 'stderr';
  sinceCursor?: number;
  sinceCursorStdout?: number;
  sinceCursorStderr?: number;
  tailChars?: number;
  limitChars?: number;
  waitMs?: number;
  pattern?: string;
  /** Skip the Bash-tool header and return stream bytes only (MCP stdio). */
  raw?: boolean;
}

export interface ProcessReadResult {
  content: string;
  nextCursorStdout: number;
  nextCursorStderr: number;
  nextCursorCombinedApprox: number;
  combinedCursorStale?: boolean;
  status: 'running' | 'exited' | 'spawn_error' | 'not_found';
  newOutput: boolean;
  exited: boolean;
  exitCode?: number | null;
  suggestedWaitMs?: number;
  ringGenerationStdout: number;
  ringGenerationStderr: number;
}

export interface ProcessListItem {
  id: string;
  command: string;
  cwd?: string;
  title?: string;
  pid?: number;
  status: 'running' | 'exited' | 'spawn_error' | 'not_found';
  runtimeMs: number;
  exitCode?: number | null;
  spawnError?: string;
  stdoutRingChars: number;
  stderrRingChars: number;
  logFile?: string;
}

export interface ProcessTerminateResult {
  ok: boolean;
  message: string;
}

export interface ProcessHandle {
  id: string;
  pid?: number;
  command: string;
  cwd?: string;
  title?: string;
  status: ProcessListItem['status'];
  logFilePath?: string;
  wait(opts?: { timeoutMs?: number; signal?: AbortSignal; maxOutputBytes?: number }): Promise<ProcessWaitResult>;
  read(opts?: ProcessReadOptions): Promise<ProcessReadResult>;
  write(data: Uint8Array): Promise<void>;
  signal(sig?: NodeJS.Signals): Promise<void>;
  terminate(opts?: { killDelayMs?: number }): Promise<ProcessTerminateResult>;
}

export interface ProcessRuntime {
  start(req: ProcessStartRequest): Promise<ProcessHandle>;
  listJobs(): Promise<ProcessListItem[]>;
  getJob(id: string): Promise<ProcessHandle | undefined>;
}

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  mimeType: string;
  truncated: boolean;
  finalUrl: string;
}

export type DnsLookupFn = (
  hostname: string,
  options: { all: true; verbatim?: boolean }
) => Promise<import('node:dns').LookupAddress[]>;

export interface HttpRuntime {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export type EnvironmentKind = 'local' | 'remote' | 'failed';

export interface Environment {
  readonly id: string;
  readonly kind?: EnvironmentKind;
  readonly info: {
    cwd: string;
    platformOs: string;
    shellPath?: string;
    workspaceRoot?: string;
    /** Exec-process home directory (`os.homedir()` on the execution plane). */
    userHome?: string;
    /** Set when this environment talks to a remote exec-server. */
    remoteUrl?: string;
  };
  readonly fs: FileSystem;
  readonly process: ProcessRuntime;
  readonly http: HttpRuntime;
  listSkills(options?: SkillListOptions): Promise<SkillListItem[]>;
  close?(): Promise<void>;
}

export const EXEC_ENV_URL = 'AGENT_SDK_EXEC_SERVER_URL';
export const EXEC_ENV_TOKEN = 'AGENT_SDK_EXEC_SERVER_TOKEN';

export type LocalEnvironmentConfig = {
  type: 'local';
  workspaceRoot?: string;
  userHome?: string;
};

export type RemoteEnvironmentConfig = {
  type: 'remote';
  url: string;
  token?: string;
  cwd?: string;
  connectTimeoutMs?: number;
  clientName?: string;
};

export type AgentEnvironmentConfig = 'local' | LocalEnvironmentConfig | RemoteEnvironmentConfig | Environment;

export function isEnvironment(value: unknown): value is Environment {
  return (
    !!value &&
    typeof value === 'object' &&
    'fs' in value &&
    'process' in value &&
    'http' in value &&
    'id' in value
  );
}
