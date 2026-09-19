import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type { Environment } from '../environment.js';
import { LocalFileSystem } from './filesystem.js';
import { LocalHttpRuntime } from './http.js';
import { LocalProcessRuntime } from './process.js';
import { getExecutorShellPath } from './shell-path.js';
import { listSkillsFromRoots } from './skills.js';
import { userSkillsRoot } from '../path-guard.js';
import type { DnsLookupFn } from '../environment.js';

export interface CreateLocalEnvironmentOptions {
  workspaceRoot?: string;
  userHome?: string;
  id?: string;
  dnsLookup?: DnsLookupFn;
}

export function createLocalEnvironment(options: CreateLocalEnvironmentOptions = {}): Environment {
  const cwd = options.workspaceRoot ?? process.cwd();
  const userHome = options.userHome ?? homedir();
  const extraRoots = userHome ? [userSkillsRoot(userHome)] : [];
  const fs = new LocalFileSystem(options.workspaceRoot, extraRoots);
  return {
    id: options.id ?? `local-${randomUUID()}`,
    kind: 'local',
    info: {
      cwd,
      platformOs: process.platform,
      shellPath: getExecutorShellPath(),
      workspaceRoot: options.workspaceRoot,
      userHome
    },
    fs,
    process: new LocalProcessRuntime(options.workspaceRoot),
    http: new LocalHttpRuntime(options.dnsLookup),
    listSkills: (opts) =>
      listSkillsFromRoots(fs, {
        userHome,
        cwd,
        workspaceSkillsPath: opts?.workspaceSkillsPath
      })
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
