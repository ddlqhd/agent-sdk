import {
  describeMissingKey,
  getOllamaBaseUrl,
  requireProviderKey,
  resolveModel as resolveControlModel,
  resolveProvider as resolveControlProvider,
  type ModelProvider
} from '@ddlqhd/agent-sdk-control';

export type { ModelProvider };

export function resolveProvider(): ModelProvider {
  return resolveControlProvider({ providerEnv: 'AGENT_SDK_ACP_PROVIDER' });
}

export function resolveModel(provider: ModelProvider): string {
  return resolveControlModel(provider, { modelEnv: 'AGENT_SDK_ACP_MODEL' });
}

export { describeMissingKey, getOllamaBaseUrl, requireProviderKey };
