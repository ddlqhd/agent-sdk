// Agent SDK - Main Entry Point

export { PACKAGE_VERSION } from './version.js';

// Core
export {
  Agent,
  createAgent,
  assertAgentEnvironmentReady,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_SUBAGENT_TIMEOUT_MS
} from './core/agent.js';
export type { StreamOptions, AgentForkSessionOptions } from './core/agent.js';
export * from './core/types.js';
export { mergeProcessEnv, mergeMcpStdioEnv } from './core/process-env-merge.js';
export { TOOL_USER_ABORTED_MESSAGE } from './core/abort-constants.js';
export {
  formatSyntheticUserSummary,
  formatSyntheticFallbackNotice,
  parseCompactionSyntheticUser
} from './core/compressor.js';
export {
  createConsoleSDKLogger,
  emitSDKLog,
  formatSDKLog,
  resolveLogRedaction,
  resolveSDKLogLevel,
  sanitizeForLogging,
  shouldEmitLog
} from './core/logger.js';
export {
  createSDKLogContext,
  sdkLog,
  withLogScope
} from './core/log-context.js';
export type { SDKLogEventInput } from './core/log-context.js';
export { adaptConsoleLogger, adaptMessageLogger } from './core/log-adapters.js';
export type { MessageLogger } from './core/log-adapters.js';
export { publishSdkDiagnostic } from './core/diagnostics.js';
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
  reconstructPrefixMessages,
  reconstructSessionUsage,
  reconstructSessionUsageRows,
  summarizeUsageRows,
  messageToSessionEntry,
  buildSummaryEntry,
  buildRewindEntry,
  buildUsageEntry,
  listSessionCheckpointsFromRaw,
  encodeCheckpointId,
  decodeCheckpointId,
  isPersistableMessageEntry,
  isUserCheckpointEntry,
  isRewindEntry,
  isUsageEntry
} from './storage/index.js';
export type { JsonlStorageConfig, SessionManagerConfig } from './storage/index.js';

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
  EnvironmentStdioTransport,
  formatMcpToolName,
  isMcpPrefixedToolName
} from './mcp/index.js';
export type { MCPTool, MCPResource, MCPPrompt, PromptMessage, MCPClientOptions } from './mcp/index.js';

// Skills
export {
  SkillLoader,
  createSkillLoader,
  SkillRegistry,
  createSkillRegistry,
  parseSkillMd,
  skillDirFromPath
} from './skills/index.js';
export type { SkillLoaderConfig } from './skills/index.js';

// Subagent profiles (markdown + registry)
export * from './subagents/index.js';

// Memory
export { MemoryManager } from './memory/index.js';
export type { MemoryConfig } from './memory/index.js';

// Workflow
export {
  loadWorkflowScript,
  scanDualCompat,
  Scheduler,
  createBudgetTracker,
  tokensFromAgentResult,
  RUN_STARTED,
  RUN_FINISHED,
  RUN_FAILED,
  RUN_STOPPED,
  PHASE_STARTED,
  LOG,
  AGENT_STARTED,
  AGENT_FINISHED,
  AGENT_FAILED,
  event,
  NullSink,
  MemorySink,
  DynamicWorkflowError,
  WorkflowScriptError,
  AgentLimitExceeded,
  BudgetExhausted,
  RunStopped,
  SchemaValidationError,
  isFatalError,
  createPrimitives,
  createDefaultAgentFactory,
  runWorkflow,
  generateWorkflow,
  validateWorkflowSource,
  DIALECT_DOC,
  PATTERNS_DIGEST,
  WORKFLOW_HARD_RULES,
  formatSchemaInstruction,
  extractJsonFromText
} from './workflow/index.js';
export type {
  SchedulerOptions,
  BudgetTracker,
  WorkflowEvent,
  EventSink,
  WorkflowPhaseMeta,
  WorkflowMeta,
  AgentPrimitiveOptions,
  Thunk,
  PipelineStage,
  WorkflowBudget,
  ValidationReport,
  WorkflowPrimitives,
  WorkflowAgentFactory,
  WorkflowRunContext,
  RunWorkflowOptions,
  WorkflowRunResult,
  GenerateWorkflowOptions,
  GenerateWorkflowResult,
  LoadedWorkflow
} from './workflow/index.js';

// Execution plane (local Environment / remote exec-server)
export {
  EXEC_ENV_TOKEN,
  EXEC_ENV_URL,
  createEnvironmentFromConfig,
  createLocalEnvironment,
  getDefaultLocalEnvironment,
  isEnvironment,
  startExecServer
} from '@ddlqhd/agent-sdk-exec';
export type {
  AgentEnvironmentConfig,
  Environment,
  EnvironmentKind,
  RemoteEnvironmentConfig,
  RunningExecServer,
  SkillListItem,
  SkillListOptions
} from '@ddlqhd/agent-sdk-exec';

// Config
export {
  loadMCPConfig,
  validateMCPConfig,
  validateMCPServerEntry
} from './config/index.js';
export type { MCPConfigFile, MCPConfigLoadResult, MCPConfigLoadError, MCPConfigLoadErrorKind } from './config/index.js';
