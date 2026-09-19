export const PROTOCOL_VERSION = '1.2.0';

export interface ProtocolVersionParts {
  major: number;
  minor: number;
  patch: number;
}

export function parseProtocolVersion(version: string): ProtocolVersionParts | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    return undefined;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Same major; server must be >= client so newer clients do not call missing methods.
 */
export function isProtocolCompatible(clientVersion: string, serverVersion: string): boolean {
  const client = parseProtocolVersion(clientVersion);
  const server = parseProtocolVersion(serverVersion);
  if (!client || !server || client.major !== server.major) {
    return false;
  }
  if (server.minor !== client.minor) {
    return server.minor > client.minor;
  }
  return server.patch >= client.patch;
}

export const METHODS = {
  initialize: 'initialize',
  initialized: 'initialized',
  environmentInfo: 'environment/info',
  environmentStatus: 'environment/status',
  processStart: 'process/start',
  processRead: 'process/read',
  processWrite: 'process/write',
  processSignal: 'process/signal',
  processTerminate: 'process/terminate',
  processWait: 'process/wait',
  processList: 'process/list',
  skillsList: 'skills/list',
  fsReadFile: 'fs/readFile',
  fsWriteFile: 'fs/writeFile',
  fsCreateDirectory: 'fs/createDirectory',
  fsGetMetadata: 'fs/getMetadata',
  fsCanonicalize: 'fs/canonicalize',
  fsReadDirectory: 'fs/readDirectory',
  fsRemove: 'fs/remove',
  fsCopy: 'fs/copy',
  fsGlob: 'fs/glob',
  fsSearch: 'fs/search',
  fsReadText: 'fs/readText',
  fsWriteText: 'fs/writeText',
  fsEdit: 'fs/edit',
  fsSpillText: 'fs/spillText',
  httpRequest: 'http/request'
} as const;

export const NOTIFICATIONS = {
  processOutput: 'process/output',
  processExited: 'process/exited',
  processClosed: 'process/closed'
} as const;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: number | string;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: number | string | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure;

export function isJsonRpcRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'method' in msg && 'id' in msg;
}

export function isJsonRpcNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return 'method' in msg && !('id' in msg);
}

export function isJsonRpcSuccess(msg: JsonRpcMessage): msg is JsonRpcSuccess {
  return 'result' in msg && 'id' in msg;
}

export function isJsonRpcFailure(msg: JsonRpcMessage): msg is JsonRpcFailure {
  return 'error' in msg;
}

export interface InitializeParams {
  clientName: string;
  protocolVersion: string;
  token?: string;
}

export interface EnvironmentInfo {
  shell: { name?: string; path?: string };
  executorVersion: string;
  cwd: string;
  platformOs: string;
  workspaceRoot?: string;
  userHome?: string;
}

export interface InitializeResult {
  sessionId: string;
  environmentInfo: EnvironmentInfo;
  protocolVersion: string;
}

export interface EnvironmentStatus {
  status: 'ready';
}

export function encodeBytes(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

export function decodeBytes(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, 'base64'));
}

export function parseJsonRpcMessage(raw: string): JsonRpcMessage {
  const parsed = JSON.parse(raw) as JsonRpcMessage;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON-RPC message');
  }
  return parsed;
}

export function serializeJsonRpcMessage(msg: JsonRpcMessage): string {
  return JSON.stringify(msg);
}
