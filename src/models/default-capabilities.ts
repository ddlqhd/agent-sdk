import type { ModelCapabilities } from '../core/types.js';

/**
 * 各提供商适配器在省略 `config.capabilities` 时共用的默认能力（上下文 200K、最大输出 32K）。
 */
export const DEFAULT_ADAPTER_CAPABILITIES: ModelCapabilities = {
  contextLength: 200_000,
  maxOutputTokens: 32_000
};
