import {
  describeMissingKey,
  getOllamaBaseUrl,
  requireProviderKey
} from '@ddlqhd/agent-sdk-control';
import type { ModelProvider } from './shared/ws-protocol.js';

export function requireProviderEnv(provider: ModelProvider): string | undefined {
  return requireProviderKey(provider);
}

export { describeMissingKey, getOllamaBaseUrl };
