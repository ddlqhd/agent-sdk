import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export type UserBaseFallback = 'home' | 'acp-tmp';

export interface ResolveUserBasePathOptions {
  explicit?: string;
  env?: NodeJS.ProcessEnv;
  /** Host-specific override, e.g. `AGENT_SDK_ACP_USER_BASE`. */
  envVar?: string;
  fallback?: UserBaseFallback | string;
}

/**
 * Resolve the user-level storage root (sessions / skills / settings).
 * Fallback defaults differ by host: CLI/Web use home; ACP uses a stable tmpdir path.
 */
export function resolveUserBasePath(options?: ResolveUserBasePathOptions): string {
  const explicit = options?.explicit?.trim();
  if (explicit) return explicit;

  const env = options?.env ?? process.env;
  if (options?.envVar) {
    const fromEnv = env[options.envVar]?.trim();
    if (fromEnv) return fromEnv;
  }

  const fallback = options?.fallback ?? 'home';
  if (fallback === 'home') return homedir();
  if (fallback === 'acp-tmp') return join(tmpdir(), 'agent-sdk-acp');
  return fallback;
}

export function resolveAcpUserBase(env: NodeJS.ProcessEnv = process.env): string {
  return resolveUserBasePath({ env, envVar: 'AGENT_SDK_ACP_USER_BASE', fallback: 'acp-tmp' });
}
