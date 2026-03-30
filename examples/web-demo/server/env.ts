import type { ModelProvider } from '../shared/ws-protocol.js';

export function requireProviderEnv(provider: ModelProvider): string | undefined {
  switch (provider) {
    case 'openai':
      return process.env.OPENAI_API_KEY;
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY;
    case 'ollama':
      return undefined;
    default:
      return undefined;
  }
}

export function getOllamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
}

export function describeMissingKey(provider: ModelProvider): string {
  switch (provider) {
    case 'openai':
      return 'Set OPENAI_API_KEY in the environment (or .env loaded by your shell).';
    case 'anthropic':
      return 'Set ANTHROPIC_API_KEY in the environment.';
    case 'ollama':
      return 'Ensure Ollama is running (default http://127.0.0.1:11434).';
    default:
      return 'Unknown provider.';
  }
}
