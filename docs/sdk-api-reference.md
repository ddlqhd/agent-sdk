# Agent SDK API 参考（公开导出）

本文档仅覆盖稳定导出入口：

- `agent-sdk`
- `agent-sdk/models`
- `agent-sdk/tools`

## 1. `agent-sdk`（根入口）

## Agent 与核心入口

- `Agent`：核心执行引擎
- `createAgent(config)`：创建 `Agent` 实例
- `DEFAULT_SYSTEM_PROMPT`：默认系统提示模板
- `StreamOptions`：`run/stream` 的调用选项

### `Agent` 常用实例方法

- `stream(input, options?)`：流式执行，返回 `AsyncIterable<StreamEvent>`
- `run(input, options?)`：非流式执行，返回 `Promise<AgentResult>`
- `waitForInit()`：等待异步初始化（skills/mcp/hook）
- `destroy()`：销毁资源（含 MCP 断连）
- `registerTool(tool)` / `registerTools(tools)`：注册工具
- `getToolRegistry()`：获取工具注册中心
- `getSessionManager()`：获取会话管理器
- `connectMCP(config)` / `disconnectMCP(name)` / `disconnectAllMCP()`：MCP 生命周期
- `loadSkill(path)` / `getSkillRegistry()`：Skill 管理
- `getMessages()` / `clearMessages()`：消息历史
- `setSystemPrompt(prompt)` / `appendSystemPrompt(content)` / `getSystemPrompt()`：系统提示词管理
- `compressContext()` / `getContextStatus()` / `getSessionUsage()`：上下文与 token 状态

### `AgentConfig` 工具与权限相关字段

- `tools`：在默认内置（及 MCP）之后**追加**的自定义工具；同名覆盖内置定义。与 `exclusiveTools` 互斥。
- `disallowedTools`：按**注册名**禁止的工具；不注册、不暴露给模型、不执行（内置 / MCP / 自定义均生效）。
- `allowedTools`：按注册名**自动批准**的执行列表。未列出者仍可对模型可见；若配置了 `allowedTools` 且某次调用不在列表内，则需 `canUseTool` 返回 true，否则拒绝。**未设置** `allowedTools` 时保持兼容：非 `disallowedTools` 的工具均自动批准。**空数组** `[]` 表示无任何自动批准：每次调用都需 `canUseTool`，未配置则全部拒绝。
- `canUseTool`：`(toolName, input) => boolean | Promise<boolean>`，在已配置 `allowedTools` 且调用未命中自动批准时使用。
- `exclusiveTools`：仅注册此处列出的工具（用于子 Agent 等排他场景），不合并默认内置；仍受 `disallowedTools` 过滤。

类型别名：`CanUseToolCallback`。

## Models（从根入口再导出）

- `createModel(config)`
- `createOpenAI(config?)`
- `createAnthropic(config?)`
- `createOllama(config?)`
- `OpenAIAdapter`
- `AnthropicAdapter`
- `OllamaAdapter`
- 类型：`OpenAIConfig` `AnthropicConfig` `OllamaConfig` `ModelProvider` `CreateModelConfig`

## Tools（从根入口再导出）

- `ToolRegistry`
- `createTool(config)`
- `getGlobalRegistry()`
- 类型：`ToolExecuteOptions` `ToolRegistryConfig`（含可选 `executionPolicy`，与 `AgentConfig` 工具策略字段对应）

### Hook 相关导出

- `HookManager`
- `createFunctionHook`
- `matchTool`
- `buildHookEnv`
- `mergeCommandHookLayers`
- `parseHooksSettingsFile`
- `loadHooksSettingsFromProject`
- `loadHooksSettingsFromUser`
- 类型：`HookContext` `HookEventType` `HookResult` `FunctionHook` `CommandHookConfig` `HookGroupConfig` `HooksSettings` `HooksSettingsFile` `FlatCommandHookEntry`

### 内置工具导出（根入口包含）

- 文件系统：`Read`/`Write`/`Edit`/`Glob` 对应的 tool 定义与 `getFileSystemTools()`
- Shell：`Bash` 与 `getShellTools()`
- 搜索：`Grep` 与 `getGrepTools()`
- Web：`WebFetch` `WebSearch` 与 `getWebTools()`
- 任务：`TaskCreate` `TaskUpdate` `TaskList` 与 `getTaskTools()`
- 交互：`AskUserQuestion`、`AskUserQuestionResolver`、`createAskUserQuestionTool()` 与 `getInteractionTools(options?)`；交互需宿主传入 `AgentConfig.askUserQuestion` 或 `getAllBuiltinTools(..., { resolve })`
- Skill 激活：`Skill` 与 `getSkillTools()`
- Subagent：`Agent`（通过 `createAgentTool()` 创建）与 `getSubagentTools()`
- 汇总：`getAllBuiltinTools(skillRegistry, interactionOptions?)` / `getSafeBuiltinTools(skillRegistry, interactionOptions?)`

## Storage

- `createStorage(config)`
- `JsonlStorage` / `createJsonlStorage(basePath?)`
- `MemoryStorage` / `createMemoryStorage()`
- `SessionManager` / `createSessionManager(config?)`

## Streaming

- `AgentStream`
- `createStream()`
- `fromAsyncIterable(iterable)`
- `StreamTransformer`
- `transformStream(chunks)`
- `toAgentStream(chunks)`
- `StreamChunkProcessor`
- 类型：`StreamChunkProcessorOptions`

## MCP

- `MCPClient` / `createMCPClient(config)`
- `MCPAdapter` / `createMCPAdapter()`
- `loadMCPConfig(configPath?, startDir?, userBasePath?)`
- `validateMCPConfig(config)`
- 类型：`MCPClientConfig` `StdioMCPConfig` `HttpMCPConfig` `MCPTool` `MCPResource` `MCPPrompt` `PromptMessage` `MCPConfigFile` `MCPConfigLoadResult`

## Skills 与 Memory

- `SkillLoader` / `createSkillLoader(config?)`
- `SkillRegistry` / `createSkillRegistry(config?)`
- `parseSkillMd(content)`
- `MemoryManager`
- 类型：`SkillLoaderConfig` `MemoryConfig`

## Core Types（根入口 `export * from core/types`）

可直接从 `agent-sdk` 导入的核心类型包括：

- 消息与内容：`Message` `MessageRole` `TextContent` `ThinkingContent` `ImageContent` `ContentPart` `ToolCall`
- 模型：`ModelAdapter` `ModelParams` `StreamChunk` `CompletionResult` `ModelCapabilities` `TokenUsage` `SessionTokenUsage`
- 工具：`ToolDefinition` `ToolHandler` `ToolResult` `ToolResultMetadata` `ToolSchema`
- 存储：`StorageConfig` `StorageAdapter` `SessionInfo`
- 流式：`StreamEventType` `StreamEvent` `StreamEventAnnotations`
- MCP：`MCPServerConfig` `MCPResource` `MCPResourceContent` `MCPPrompt` `MCPPromptArgument`
- Skills：`SkillMetadata` `SkillDefinition` `ParsedSkill`
- Agent 配置：`SystemPromptConfig` `SystemPrompt` `ContextManagerConfig` `AgentConfig` `SkillConfig` `AgentCallbacks` `AgentResult`
  - `AgentConfig.subagent` 支持 `enabled/maxDepth/maxParallel/timeoutMs/allowDangerousTools/defaultAllowedTools`
  - `ToolExecutionContext.agentDepth` 用于限制 subagent 嵌套
- CLI 相关导出类型：`CLIConfig` `ChatOptions` `RunOptions` `ToolListOptions` `SessionListOptions` `MCPOptions` `SkillOptions`

---

## 2. `agent-sdk/models`

适用于只关心模型适配的场景。

### 公开导出

- 工厂：`createModel` `createOpenAI` `createAnthropic` `createOllama`
- 适配器类：`OpenAIAdapter` `AnthropicAdapter` `OllamaAdapter`
- 高级导出：`BaseModelAdapter` `zodToJsonSchema` `toolsToModelSchema` `mergeTokenUsage`
- 类型：`OpenAIConfig` `AnthropicConfig` `OllamaConfig` `ModelProvider` `CreateModelConfig`

> 建议第三方优先使用工厂函数，`BaseModelAdapter` 与 schema 辅助函数偏高级/扩展场景。

---

## 3. `agent-sdk/tools`

适用于“只接工具系统”的场景。

### 公开导出

- 注册与执行：`ToolRegistry` `createTool` `getGlobalRegistry`
- 工具类型：`ToolDefinition` `ToolResult` `ToolSchema` `ToolResultMetadata`
- Hook：同根入口 hooks
- 输出处理：`OutputHandler` `createOutputHandler` `FileStorageStrategy` `PaginationHintStrategy` `SmartTruncateStrategy` `OUTPUT_CONFIG`
- 类型：`OutputStrategy` `ToolExecuteOptions` `ToolRegistryConfig`
- 内置工具：`export * from ./builtin`

> 普通应用只需 `createTool` + `ToolRegistry`；`OutputHandler` 与策略类通常用于 CLI/高级输出治理。

