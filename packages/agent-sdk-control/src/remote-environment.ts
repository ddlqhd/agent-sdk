export const EXEC_SERVER_URL_ENV = 'AGENT_SDK_EXEC_SERVER_URL';
export const EXEC_SERVER_TOKEN_ENV = 'AGENT_SDK_EXEC_SERVER_TOKEN';

export interface RemoteEnvironmentRef {
  type: 'remote';
  url: string;
  token?: string;
}

export interface ResolveRemoteEnvironmentOptions {
  url?: string;
  token?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Same remote-exec resolution used by CLI flags and ACP/Web env.
 * Returns undefined when the host should keep the SDK default (local / Agent env fallback).
 */
export function resolveRemoteEnvironmentConfig(
  options?: ResolveRemoteEnvironmentOptions
): RemoteEnvironmentRef | undefined {
  const env = options?.env ?? process.env;
  const url = options?.url?.trim() || env[EXEC_SERVER_URL_ENV]?.trim();
  if (!url || url === 'none') return undefined;
  const token = options?.token?.trim() || env[EXEC_SERVER_TOKEN_ENV]?.trim() || undefined;
  return { type: 'remote', url, ...(token ? { token } : {}) };
}
