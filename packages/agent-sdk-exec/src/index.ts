export { PACKAGE_VERSION } from './version.js';
export { PROTOCOL_VERSION, METHODS, NOTIFICATIONS } from './protocol.js';
export type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcNotification,
  InitializeParams,
  InitializeResult,
  EnvironmentInfo
} from './protocol.js';
export {
  encodeBytes,
  decodeBytes,
  parseJsonRpcMessage,
  serializeJsonRpcMessage
} from './protocol.js';
export type {
  Environment,
  EnvironmentKind,
  FileSystem,
  ProcessRuntime,
  HttpRuntime,
  FileStat,
  DirEntry,
  ReadTextOptions,
  ReadTextResult,
  GlobMatch,
  SearchOptions,
  SearchResult,
  ProcessStartRequest,
  ProcessHandle,
  ProcessReadResult,
  ProcessListItem,
  HttpRequest,
  HttpResponse,
  DnsLookupFn,
  AgentEnvironmentConfig,
  LocalEnvironmentConfig,
  RemoteEnvironmentConfig
} from './environment.js';
export {
  EXEC_ENV_URL,
  EXEC_ENV_TOKEN,
  isEnvironment
} from './environment.js';
export { ExecError, ExecPathError, ExecAuthError } from './errors.js';
export { createLocalEnvironment, getDefaultLocalEnvironment } from './local/environment.js';
export { LocalFileSystem } from './local/filesystem.js';
export { LocalProcessRuntime } from './local/process.js';
export { LocalHttpRuntime } from './local/http.js';
export {
  isDangerousIp,
  isBlockedHostname,
  assertHttpUrl,
  assertUrlSafeForFetch,
  assertResolvableHostSafe
} from './local/ssrf.js';
export {
  detectEncodingFromSample,
  isNativeReadEncoding,
  isFilesystemEncodingSupported,
  normalizeFilesystemEncoding,
  readEncodingSample,
  readFileAsUnicodeString,
  writeFileFromUnicodeString
} from './local/encoding.js';
export { truncateMatchLineForDisplay, DEFAULT_GREP_HEAD_LIMIT, MAX_GREP_LINE_LENGTH } from './local/glob-search.js';
export { buildShellInvocation } from './local/invocation.js';
export type { ShellInvocation } from './local/invocation.js';
export {
  spawnBackgroundJob,
  readJobOutput,
  listBackgroundJobs,
  terminateJob,
  getBackgroundJob,
  installProcessExitCleanup,
  disposeAllJobs,
  flattenCombined,
  deleteJob,
  jobCount
} from './local/process-manager.js';
export type {
  BashJobRecord,
  BashSpawnOptions,
  BashReadOutputOptions,
  BashOutputResult,
  BashJobSummary
} from './local/process-manager.js';
export { getExecutorShellPath } from './local/shell-path.js';
export { createEnvironmentFromConfig, createFailedEnvironment } from './factory.js';
export { connectRemoteEnvironment, ExecRpcClient } from './client/remote.js';
export { startExecServer, parseListenAddress } from './server/server.js';
export type { ExecServerOptions, RunningExecServer } from './server/server.js';
export {
  formatExecServerLogLine,
  printExecServerLog,
  summarizeRpcParams
} from './server/log.js';
export type {
  ExecServerLogEvent,
  ExecServerLogEventName,
  ExecServerLogFn
} from './server/log.js';
export { runExecServerCli } from './cli.js';
