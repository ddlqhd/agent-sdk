import {
  EXEC_ENV_TOKEN,
  EXEC_ENV_URL,
  isEnvironment,
  type AgentEnvironmentConfig,
  type Environment
} from './environment.js';
import { createLocalEnvironment } from './local/environment.js';
import { connectRemoteEnvironment, createFailedEnvironment } from './client/remote.js';

export interface ResolveEnvironmentOptions {
  env?: NodeJS.ProcessEnv;
}

/**
 * Build an {@link Environment} from Agent/CLI config plus `AGENT_SDK_EXEC_SERVER_*` env vars.
 */
export async function createEnvironmentFromConfig(
  config?: AgentEnvironmentConfig,
  options?: ResolveEnvironmentOptions
): Promise<Environment> {
  const env = options?.env ?? process.env;
  const url = env[EXEC_ENV_URL]?.trim();
  const token = env[EXEC_ENV_TOKEN]?.trim();

  if (config !== undefined && isEnvironment(config)) {
    return config;
  }

  if (config && typeof config === 'object' && config.type === 'remote') {
    return connectRemoteEnvironment({
      ...config,
      token: config.token ?? token
    });
  }

  if (config && typeof config === 'object' && config.type === 'local') {
    return createLocalEnvironment({ workspaceRoot: config.workspaceRoot });
  }

  if (config === 'local') {
    return createLocalEnvironment();
  }

  if (url && url !== 'none') {
    return connectRemoteEnvironment({ type: 'remote', url, token });
  }

  return createLocalEnvironment();
}

export { createFailedEnvironment };
