/**
 * Shared model-provider ids used by first-party hosts.
 */
export type ModelProvider = 'openai' | 'anthropic' | 'ollama';

export const MODEL_PROVIDERS = ['openai', 'anthropic', 'ollama'] as const;

export function isModelProvider(value: string): value is ModelProvider {
  return (MODEL_PROVIDERS as readonly string[]).includes(value);
}
