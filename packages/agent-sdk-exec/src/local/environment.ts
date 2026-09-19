import { randomUUID } from 'node:crypto';
import type { Environment } from '../environment.js';
import { LocalFileSystem } from './filesystem.js';
import { LocalHttpRuntime } from './http.js';
import { LocalProcessRuntime } from './process.js';
import { getExecutorShellPath } from './shell-path.js';
import type { DnsLookupFn } from '../environment.js';

export interface CreateLocalEnvironmentOptions {
  workspaceRoot?: string;
  id?: string;
  dnsLookup?: DnsLookupFn;
}

export function createLocalEnvironment(options: CreateLocalEnvironmentOptions = {}): Environment {
  const cwd = options.workspaceRoot ?? process.cwd();
  return {
    id: options.id ?? `local-${randomUUID()}`,
    kind: 'local',
    info: {
      cwd,
      platformOs: process.platform,
      shellPath: getExecutorShellPath(),
      workspaceRoot: options.workspaceRoot
    },
    fs: new LocalFileSystem(options.workspaceRoot),
    process: new LocalProcessRuntime(options.workspaceRoot),
    http: new LocalHttpRuntime(options.dnsLookup)
  };
}

let defaultLocal: Environment | undefined;

/** Shared in-process environment for tools invoked without an Agent-injected context. */
export function getDefaultLocalEnvironment(): Environment {
  if (!defaultLocal) {
    defaultLocal = createLocalEnvironment();
  }
  return defaultLocal;
}
