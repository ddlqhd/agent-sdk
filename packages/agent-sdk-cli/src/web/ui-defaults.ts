import { normalizeHttpBaseUrl } from '../utils/http-base-url.js';
import type { WebRuntimeDefaults } from './agent-factory.js';
import { maskApiKey } from './shared/log-utils.js';
import type { WebUiDefaults } from './shared/ws-protocol.js';

/**
 * Handshake defaults for the browser. The API key stays on the server; the page gets a mask.
 */
export function toUiDefaults(defaults: WebRuntimeDefaults): WebUiDefaults {
  const baseUrl = defaults.baseUrl ? normalizeHttpBaseUrl(defaults.baseUrl) : undefined;
  return {
    cwd: defaults.cwd,
    userBasePath: defaults.userBasePath,
    ...(defaults.mcpConfigPath ? { mcpConfigPath: defaults.mcpConfigPath } : {}),
    ...(defaults.provider ? { provider: defaults.provider } : {}),
    ...(defaults.model ? { model: defaults.model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(defaults.apiKey
      ? { hasApiKey: true, apiKeyHint: maskApiKey(defaults.apiKey) }
      : {}),
    ...(defaults.temperature !== undefined ? { temperature: defaults.temperature } : {}),
    ...(defaults.contextLength !== undefined ? { contextLength: defaults.contextLength } : {}),
    ...(defaults.thinking !== undefined ? { thinking: defaults.thinking } : {}),
    ...(defaults.thinkingLevel ? { thinkingLevel: defaults.thinkingLevel } : {}),
    ...(defaults.storage ? { storage: defaults.storage } : {}),
    ...(defaults.safeToolsOnly === true ? { safeToolsOnly: true } : {}),
    ...(typeof defaults.memory === 'boolean' ? { memory: defaults.memory } : {}),
    ...(typeof defaults.contextManagement === 'boolean'
      ? { contextManagement: defaults.contextManagement }
      : {})
  };
}
