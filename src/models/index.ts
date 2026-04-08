// Model adapters
export {
  BaseModelAdapter,
  zodToJsonSchema,
  toolsToModelSchema,
  mergeTokenUsage
} from './base.js';
export type { ZodToJsonSchemaOptions } from './base.js';
export { OpenAIAdapter, createOpenAI } from './openai.js';
export type { OpenAIConfig } from './openai.js';
export { AnthropicAdapter, createAnthropic } from './anthropic.js';
export type {
  AnthropicConfig,
  AnthropicRequestMetadata,
  AnthropicFetchRetryOptions
} from './anthropic.js';
export { OllamaAdapter, createOllama } from './ollama.js';
export type { OllamaConfig, OllamaThinkOption } from './ollama.js';
export { ollamaStreamChunksFromChatData, ollamaMessageContentToApiString } from './ollama.js';

import type { ModelAdapter } from '../core/types.js';
import { mergeProcessEnv } from '../core/process-env-merge.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { OllamaAdapter } from './ollama.js';
import type { OllamaThinkOption } from './ollama.js';

export type ModelProvider = 'openai' | 'anthropic' | 'ollama';

export interface CreateModelConfig {
  provider: ModelProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Ollama only: passed as `think` on `/api/chat`. */
  think?: OllamaThinkOption;
}

/**
 * 创建模型适配器。
 * 若传入 `agentEnv`，先与当前进程环境合并（`mergeProcessEnv`），再解析各提供商的默认密钥/URL；省略时等价于仅使用 `process.env` 快照。
 */
export function createModel(
  modelConfig: CreateModelConfig,
  agentEnv?: Record<string, string>
): ModelAdapter {
  const merged = mergeProcessEnv(agentEnv);
  switch (modelConfig.provider) {
    case 'openai':
      return new OpenAIAdapter({
        apiKey: modelConfig.apiKey || merged.OPENAI_API_KEY || '',
        baseUrl: modelConfig.baseUrl || merged.OPENAI_BASE_URL,
        model: modelConfig.model,
        organization: merged.OPENAI_ORG_ID
      });
    case 'anthropic':
      return new AnthropicAdapter({
        apiKey: modelConfig.apiKey || merged.ANTHROPIC_API_KEY || '',
        baseUrl: modelConfig.baseUrl || merged.ANTHROPIC_BASE_URL,
        model: modelConfig.model
      });
    case 'ollama':
      return new OllamaAdapter({
        baseUrl: modelConfig.baseUrl || merged.OLLAMA_BASE_URL,
        model: modelConfig.model,
        think: modelConfig.think
      });
  }
  throw new Error(`Unknown model provider: ${(modelConfig as { provider: string }).provider}`);
}
