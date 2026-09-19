import { isModelProvider, type ModelProvider } from './types.js';

export interface ResolveProviderOptions {
  env?: NodeJS.ProcessEnv;
  /** Host-specific override, e.g. `AGENT_SDK_ACP_PROVIDER`. */
  providerEnv?: string;
}

export interface ResolveModelOptions {
  env?: NodeJS.ProcessEnv;
  /** Host-specific override, e.g. `AGENT_SDK_ACP_MODEL`. */
  modelEnv?: string;
}

export const DEFAULT_MODELS: Record<ModelProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4.1',
  ollama: 'llama3.2'
};

export function resolveProvider(options?: ResolveProviderOptions): ModelProvider {
  const env = options?.env ?? process.env;
  if (options?.providerEnv) {
    const raw = env[options.providerEnv]?.trim().toLowerCase();
    if (raw && isModelProvider(raw)) return raw;
  }
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.OPENAI_API_KEY) return 'openai';
  return 'ollama';
}

export function resolveModel(provider: ModelProvider, options?: ResolveModelOptions): string {
  const env = options?.env ?? process.env;
  if (options?.modelEnv) {
    const fromHost = env[options.modelEnv]?.trim();
    if (fromHost) return fromHost;
  }
  if (provider === 'ollama') {
    return env.OLLAMA_MODEL?.trim() || DEFAULT_MODELS.ollama;
  }
  return DEFAULT_MODELS[provider];
}

export function requireProviderKey(
  provider: ModelProvider,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  switch (provider) {
    case 'openai':
      return env.OPENAI_API_KEY;
    case 'anthropic':
      return env.ANTHROPIC_API_KEY;
    case 'ollama':
      return undefined;
    default:
      return undefined;
  }
}

export function getOllamaBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
}

export function describeMissingKey(provider: ModelProvider): string {
  switch (provider) {
    case 'openai':
      return 'Set OPENAI_API_KEY in the environment (or use provider ollama).';
    case 'anthropic':
      return 'Set ANTHROPIC_API_KEY in the environment.';
    case 'ollama':
      return 'Ensure Ollama is running (OLLAMA_BASE_URL, default http://127.0.0.1:11434).';
    default:
      return 'Unknown provider.';
  }
}

export function resolveModelBaseUrl(
  provider: ModelProvider,
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (explicit?.trim()) return explicit.trim();
  if (provider === 'ollama') return getOllamaBaseUrl(env);
  if (provider === 'openai') return env.OPENAI_BASE_URL?.trim() || undefined;
  if (provider === 'anthropic') return env.ANTHROPIC_BASE_URL?.trim() || undefined;
  return undefined;
}
