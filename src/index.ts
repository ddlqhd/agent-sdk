// Agent SDK - Main Entry Point

export { PACKAGE_VERSION } from './version.js';

// Core
export {
  Agent,
  createAgent,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_SUBAGENT_TIMEOUT_MS
} from './core/agent.js';
export type { StreamOptions } from './core/agent.js';
export * from './core/types.js';
export { mergeProcessEnv, mergeMcpStdioEnv } from './core/process-env-merge.js';
export { TOOL_USER_ABORTED_MESSAGE } from './core/abort-constants.js';
export {
  formatSyntheticUserSummary,
  formatSyntheticFallbackNotice,
  parseCompactionSyntheticUser
} from './core/compressor.js';
export { createConsoleSDKLogger, formatSDKLog } from './core/logger.js';
export { createFileJSONLLogger } from './core/file-logger.js';
export type { FileJSONLLogger, FileJSONLLoggerOptions } from './core/file-logger.js';

// Models
export {
  createModel,
  createOpenAI,
  createAnthropic,
  createOllama,
  DEFAULT_ADAPTER_CAPABILITIES,
  OpenAIAdapter,
  AnthropicAdapter,
  OllamaAdapter
} from './models/index.js';
export type {
  OpenAIConfig,
  AnthropicConfig,
  AnthropicFetchRetryOptions,
  AnthropicThinkingOption,
  AnthropicThinkingConfigObject,
  AnthropicThinkingEffort,
  OllamaConfig,
  ModelProvider,
  CreateModelConfig
} from './models/index.js';
export { applyAnthropicThinking } from './models/index.js';

// Tools
export { ToolRegistry, createTool, getGlobalRegistry } from './tools/index.js';
export type { ToolExecuteOptions, ToolRegistryConfig } from './tools/index.js';
export {
  HookManager,
  createFunctionHook,
  matchTool,
  matchesHookIfClause,
  parsePreToolUseCommandOutput,
  buildHookEnv,
  mergeCommandHookLayers,
  parseHooksSettingsFile,
  loadHooksSettingsFromProject,
  loadHooksSettingsFromUser
} from './tools/index.js';
export type {
  HookContext,
  HookEventType,
  HookResult,
  FunctionHook,
  CommandHookConfig,
  HookGroupConfig,
  HooksSettings,
  HooksSettingsFile,
  FlatCommandHookEntry
} from './tools/index.js';
export * from './tools/builtin/index.js';

// Storage
export {
  createStorage,
  getLatestSessionId,
  getSessionStoragePath,
  JsonlStorage,
  createJsonlStorage,
  MemoryStorage,
  createMemoryStorage,
  SessionManager,
  createSessionManager,
  reconstructActiveMessages,
  messageToSessionEntry,
  buildSummaryEntry
} from './storage/index.js';
export type { JsonlStorageConfig } from './storage/jsonl.js';

// Streaming
export {
  AgentStream,
  createStream,
  fromAsyncIterable,
  StreamChunkProcessor
} from './streaming/index.js';
export type { StreamChunkProcessorOptions } from './streaming/index.js';

// MCP
export {
  MCPClient,
  createMCPClient,
  MCPAdapter,
  createMCPAdapter,
  formatMcpToolName,
  isMcpPrefixedToolName
} from './mcp/index.js';
export type { MCPTool, MCPResource, MCPPrompt, PromptMessage } from './mcp/index.js';

// Skills
export {
  SkillLoader,
  createSkillLoader,
  SkillRegistry,
  createSkillRegistry,
  parseSkillMd
} from './skills/index.js';
export type { SkillLoaderConfig } from './skills/index.js';

// Subagent profiles (markdown + registry)
export * from './subagents/index.js';

// Memory
export { MemoryManager } from './memory/index.js';
export type { MemoryConfig } from './memory/index.js';

// Config
export {
  loadMCPConfig,
  validateMCPConfig,
  validateMCPServerEntry
} from './config/index.js';
export type { MCPConfigFile, MCPConfigLoadResult, MCPConfigLoadError, MCPConfigLoadErrorKind } from './config/index.js';
