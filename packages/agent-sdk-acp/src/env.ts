export type ModelProvider = 'openai' | 'anthropic' | 'ollama';

export function resolveProvider(): ModelProvider {
  const raw = process.env.AGENT_SDK_ACP_PROVIDER?.trim().toLowerCase();
  if (raw === 'anthropic' || raw === 'ollama' || raw === 'openai') {
    return raw;
  }
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'ollama';
}

export function resolveModel(provider: ModelProvider): string {
  const fromEnv = process.env.AGENT_SDK_ACP_MODEL?.trim();
  if (fromEnv) return fromEnv;
  switch (provider) {
    case 'anthropic':
      return 'claude-sonnet-4-20250514';
    case 'openai':
      return 'gpt-4.1';
    case 'ollama':
      return process.env.OLLAMA_MODEL || 'llama3.2';
    default:
      return 'gpt-4.1';
  }
}

export function requireProviderKey(provider: ModelProvider): string | undefined {
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
      return 'Set OPENAI_API_KEY (or AGENT_SDK_ACP_PROVIDER=ollama).';
    case 'anthropic':
      return 'Set ANTHROPIC_API_KEY.';
    case 'ollama':
      return 'Ensure Ollama is running (OLLAMA_BASE_URL).';
    default:
      return 'Unknown provider.';
  }
}
