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
export { StreamTransformer, transformStream, toAgentStream } from './streaming/transform.js';

// MCP
export {
  MCPClient,
  createMCPClient,
  MCPAdapter,
  createMCPAdapter,
  createStdioTransport,
  createHttpTransport,
  createWebSocketTransport,
  createMCPServerConfig,
  MCPServers
} from './mcp/index.js';
export type { MCPClientConfig, MCPToolDefinition, TransportConfig, TransportType } from './mcp/index.js';

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
