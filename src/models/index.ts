// Model adapters
export { DEFAULT_ADAPTER_CAPABILITIES } from './default-capabilities.js';
export {
  BaseModelAdapter,
  joinApiUrl,
  normalizeApiBaseUrl,
  ensureApiVersionSuffix,
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
  AnthropicFetchRetryOptions,
  AnthropicThinkingOption,
  AnthropicThinkingConfigObject,
  AnthropicThinkingEffort,
  AnthropicThinkingDisplay
} from './anthropic.js';
export { applyAnthropicThinking, buildAnthropicWireMessages } from './anthropic.js';
export { OllamaAdapter, createOllama } from './ollama.js';
export type { OllamaConfig, OllamaThinkOption } from './ollama.js';
export { ollamaStreamChunksFromChatData, ollamaMessageContentToApiString } from './ollama.js';

import type { ModelAdapter } from '../core/types.js';
import { mergeProcessEnv } from '../core/process-env-merge.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { OllamaAdapter } from './ollama.js';

export type ModelProvider = 'openai' | 'anthropic' | 'ollama';

export interface CreateModelConfig {
  provider: ModelProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /**
   * 统一「是否启用 thinking / reasoning」开关；各适配器按需映射到自己的请求字段。
   * 省略时不在请求里注入相关字段（使用服务端默认）。
   * - Anthropic：`thinking` / `output_config`（布尔 → enabled+默认 budget / disabled）。
   * - Ollama：请求的 `think` 由 {@link thinkingLevel} 或 {@link thinking}（布尔）映射。
   * - OpenAI（vLLM 风格）：`chat_template_kwargs.enable_thinking`。
   */
  thinking?: boolean;
  /**
   * 仅 `provider: 'ollama'`：推理档位，映射为请求的 `think`（`low`/`medium`/`high`）。
   * 若与 {@link thinking} 同时设置，以此为准。
   */
  thinkingLevel?: 'low' | 'medium' | 'high';
  /**
   * 在构建完默认请求体后**浅合并**到 JSON 顶层，可覆盖已有字段。
   */
  extraBody?: Record<string, unknown>;
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
        organization: merged.OPENAI_ORG_ID,
        thinking: modelConfig.thinking,
        extraBody: modelConfig.extraBody
      });
    case 'anthropic':
      return new AnthropicAdapter({
        apiKey: modelConfig.apiKey || merged.ANTHROPIC_API_KEY || '',
        baseUrl: modelConfig.baseUrl || merged.ANTHROPIC_BASE_URL,
        model: modelConfig.model,
        thinking: modelConfig.thinking,
        extraBody: modelConfig.extraBody
      });
    case 'ollama':
      return new OllamaAdapter({
        baseUrl: modelConfig.baseUrl || merged.OLLAMA_BASE_URL,
        model: modelConfig.model,
        think: modelConfig.thinkingLevel ?? modelConfig.thinking,
        extraBody: modelConfig.extraBody
      });
  }
  throw new Error(`Unknown model provider: ${(modelConfig as { provider: string }).provider}`);
}
