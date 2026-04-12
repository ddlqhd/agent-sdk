// Tools module
export { ToolRegistry, createTool, getGlobalRegistry } from './registry.js';
export type { ToolExecuteOptions, ToolRegistryConfig } from './registry.js';
export type { ToolDefinition, ToolResult, ToolSchema, ToolResultMetadata } from '../core/types.js';

// Tool hooks
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
} from './hooks/index.js';
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
} from './hooks/index.js';

// Output handler
export {
  OutputHandler,
  createOutputHandler,
  FileStorageStrategy,
  PaginationHintStrategy,
  SmartTruncateStrategy,
  OUTPUT_CONFIG
} from './output-handler.js';
export type { OutputStrategy } from './output-handler.js';

// Built-in tools
export * from './builtin/index.js';
