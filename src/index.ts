// Agent SDK - Main Entry Point

// Core
export { Agent, createAgent } from './core/agent.js';
export type { StreamOptions } from './core/agent.js';
export * from './core/types.js';
export { DEFAULT_SYSTEM_PROMPT } from './core/prompts.js';

// Models
export {
  createModel,
  createOpenAI,
  createAnthropic,
  createOllama,
  OpenAIAdapter,
  AnthropicAdapter,
  OllamaAdapter
} from './models/index.js';
export type { OpenAIConfig, AnthropicConfig, OllamaConfig, ModelProvider, CreateModelConfig } from './models/index.js';

// Tools
export { ToolRegistry, createTool, getGlobalRegistry } from './tools/index.js';
export type { ToolExecuteOptions } from './tools/index.js';
export {
  HookManager,
  createFunctionHook,
  matchTool,
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
  JsonlStorage,
  createJsonlStorage,
  MemoryStorage,
  createMemoryStorage,
  SessionManager,
  createSessionManager
} from './storage/index.js';

// Streaming
export { AgentStream, createStream, fromAsyncIterable } from './streaming/index.js';
export {
  StreamTransformer,
  transformStream,
  toAgentStream,
  StreamChunkProcessor
} from './streaming/transform.js';
export type { StreamChunkProcessorOptions } from './streaming/chunk-processor.js';

// MCP
export {
  MCPClient,
  createMCPClient,
  MCPAdapter,
  createMCPAdapter
} from './mcp/index.js';
export type {
  MCPClientConfig,
  StdioMCPConfig,
  HttpMCPConfig,
  MCPTool,
  MCPResource,
  MCPPrompt,
  PromptMessage
} from './mcp/index.js';

// Skills
export {
  SkillLoader,
  createSkillLoader,
  SkillRegistry,
  createSkillRegistry,
  parseSkillMd
} from './skills/index.js';
export type { SkillLoaderConfig } from './skills/index.js';

// Memory
export { MemoryManager } from './memory/index.js';
export type { MemoryConfig } from './memory/index.js';

// Config
export {
  loadMCPConfig,
  validateMCPConfig
} from './config/index.js';
export type { MCPConfigFile, MCPConfigLoadResult } from './config/index.js';
