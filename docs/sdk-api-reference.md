# Agent SDK API 参考（公开导出）

本文档仅覆盖稳定导出入口：

- `@ddlqhd/agent-sdk`
- `@ddlqhd/agent-sdk/models`
- `@ddlqhd/agent-sdk/tools`

根包另有 `export * from './core/types.js'`、`export * from './tools/builtin/index.js'` 等；下文对类型与内置符号为**代表性列举，非穷尽**（完整符号以构建产物与 IDE 补全为准）。

## 1. `@ddlqhd/agent-sdk`（根入口）

### 根入口其他导出

- `PACKAGE_VERSION`：当前包版本字符串（与发布包版本一致）
- `mergeProcessEnv` / `mergeMcpStdioEnv`：合并进程环境变量（MCP stdio 子进程等场景）
- `createConsoleSDKLogger` / `formatSDKLog`：控制台日志辅助（可与 `AgentConfig.logger` 配合）

### `Agent` 类与构造

- `Agent`：核心执行引擎
- `createAgent(config)`：创建 `Agent` 实例
- `DEFAULT_MAX_ITERATIONS`：未配置 `AgentConfig.maxIterations` 时的默认模型↔工具轮次上限（400）
- `DEFAULT_SYSTEM_PROMPT`：默认系统提示模板
- `StreamOptions`：`run/stream` 的调用选项

### `Agent` 常用实例方法

- `stream(input, options?)`：流式执行，返回 `AsyncIterable<StreamEvent>`（各 `type` 的字段与产生时机见 [`sdk-types-reference.md`](./sdk-types-reference.md) 第 5 节）
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
- `getMCPAdapter()`：返回当前 `MCPAdapter` 或 `null`（未连接 MCP 时）
- `processInput(input)`：解析 `/skill-name` 形式输入并可选调用 skill，返回是否已触发及替换后的 prompt（`Agent.stream`/`run` 内部已调用）
- `invokeSkill(name, args?)`：按名称加载 skill 内容并做模板处理，返回可注入对话的 prompt 字符串

### `AgentConfig` 工具与权限相关字段

- `tools`：在默认内置（及 MCP）之后**追加**的自定义工具；同名覆盖内置定义。与 `exclusiveTools` 互斥。
- `disallowedTools`：按**注册名**禁止的工具；不注册、不暴露给模型、不执行（内置 / MCP / 自定义均生效）。
- `allowedTools`：按注册名**自动批准**的执行列表。未列出者仍可对模型可见；若配置了 `allowedTools` 且某次调用不在列表内，则需 `canUseTool` 返回 true，否则拒绝。**未设置** `allowedTools` 时保持兼容：非 `disallowedTools` 的工具均自动批准。**空数组** `[]` 表示无任何自动批准：每次调用都需 `canUseTool`，未配置则全部拒绝。
- `canUseTool`：`(toolName, input) => boolean | Promise<boolean>`，在已配置 `allowedTools` 且调用未命中自动批准时使用。
- `exclusiveTools`：仅注册此处列出的工具（用于子 Agent 等排他场景），不合并默认内置；仍受 `disallowedTools` 过滤。

类型别名：`CanUseToolCallback`。

### 替换内置工具

集成应用若需**用自己的实现替换某个内置工具**（例如自定义 `Read` 的落盘策略）：

1. **推荐：在 `AgentConfig.tools` 中提供同名工具**  
   初始化顺序为先注册全部默认内置，再处理 `tools`：**注册名与内置一致时，会先 `unregister` 再注册你的定义**，模型看到的名称与 JSON Schema 以你的 `ToolDefinition` 为准（若与内置参数不同，需自行保证与系统提示/业务一致）。

2. **与 `disallowedTools` 的关系**  
   若某工具名出现在 `disallowedTools` 中，该名**不会**注册内置版本，且 **`tools` 里同名项也会被跳过**。要“替换”某内置工具时，**不要**把该名放进 `disallowedTools`。

3. **与 `exclusiveTools` 的关系**  
   设置 `exclusiveTools` 时**不会**加载默认内置集合，也不会再应用 `tools` 字段；需自行列出完整工具表（含你要保留或改写后的工具）。

4. **创建 Agent 之后再替换**  
   `Agent.registerTool` 在名已存在时会抛错。应先 `agent.getToolRegistry().unregister('Read')`（或对应名），再 `registerTool` 新定义。

示例代码见 [`sdk-integration-recipes.md`](./sdk-integration-recipes.md) 第 3 节。

### Models（从根入口再导出）

**集成约定**：`createModel` / `createOpenAI` / `createAnthropic` / `createOllama` 仅用于构造传入 `Agent` 的 `model`。应用代码须通过 `Agent` 执行，**勿**直接调用适配器上的 `stream` / `complete` 等执行型 API（见 [`sdk-overview.md`](./sdk-overview.md) 第 3 节）。导出的适配器类主要用于类型或高级场景；第三方默认以 `Agent` 为准。

- `createModel(config)`
- `createOpenAI(config?)`
- `createAnthropic(config?)`
- `createOllama(config?)`
- `DEFAULT_ADAPTER_CAPABILITIES`：OpenAI / Anthropic / Ollama 在省略工厂 `capabilities` 时共用的默认 `ModelCapabilities`（200K 上下文、32K 输出上限）；见 [`sdk-types-reference.md`](./sdk-types-reference.md)。
- `OpenAIAdapter`
- `AnthropicAdapter`
- `OllamaAdapter`
- 类型：`OpenAIConfig` `AnthropicConfig` `AnthropicFetchRetryOptions` `AnthropicThinkingOption` `AnthropicThinkingConfigObject` `AnthropicThinkingEffort` `OllamaConfig` `ModelProvider` `CreateModelConfig`
- 辅助：`applyAnthropicThinking`（将 `AnthropicThinkingOption` 归一化为 Messages API 的 `thinking` 与可选 `output_config`；通常由适配器使用，高级场景可自测归一化结果）

### Tools（从根入口再导出）

- `ToolRegistry`
- `createTool(config)`
- `getGlobalRegistry()`
- 类型：`ToolExecuteOptions` `ToolRegistryConfig`（含可选 `executionPolicy`，与 `AgentConfig` 工具策略字段对应）

### Hook 相关导出

- `HookManager`
- `createFunctionHook`
- `matchTool`
- `matchesHookIfClause`
- `parsePreToolUseCommandOutput`
- `buildHookEnv`
- `mergeCommandHookLayers`
- `parseHooksSettingsFile`
- `loadHooksSettingsFromProject`
- `loadHooksSettingsFromUser(userBasePath?)`：省略 `userBasePath` 时读 `homedir()/.claude/settings.json`，否则读 `{userBasePath}/.claude/settings.json`（与 Agent `userBasePath` / CLI `--user-base-path` 对齐）
- 类型：`HookContext` `HookEventType` `HookResult` `FunctionHook` `CommandHookConfig` `HookGroupConfig` `HooksSettings` `HooksSettingsFile` `FlatCommandHookEntry`

### 内置工具导出（根入口包含）

用户向工具名称与能力表见 [`sdk-built-in-tools.md`](./sdk-built-in-tools.md)。

- 文件系统：`Read`/`Write`/`Edit`/`Glob` 对应的 tool 定义与 `getFileSystemTools()`
- Shell：`Bash` 与 `getShellTools()`
- 搜索：`Grep` 与 `getGrepTools()`（工作区内正则逐行扫描，非调用外部 `rg`；目录搜索时尊重搜索根下的 `.gitignore`）
- Web：`WebFetch` `WebSearch` 与 `getWebTools()`
- 任务规划：`TodoWrite` 与 `getPlanningTools()`
- 交互：`AskUserQuestion`、`AskUserQuestionResolver`、`createAskUserQuestionTool()` 与 `getInteractionTools(options?)`；交互需宿主传入 `AgentConfig.askUserQuestion` 或 `getAllBuiltinTools(..., { resolve })`
- Skill 激活：`Skill` 与 `getSkillTools()`
- Subagent：`Agent`（通过 `createAgentTool()` 创建）与 `getSubagentTools()`
- 汇总：`getAllBuiltinTools(skillRegistry, interactionOptions?)` / `getSafeBuiltinTools(skillRegistry, interactionOptions?)`

### Storage

- `createStorage(config)`
- `getSessionStoragePath(userBasePath?)` / `getLatestSessionId(userBasePath?)`：会话目录与「最近会话 id」解析（与 CLI `--user-base-path` / `--resume` 一致）
- `JsonlStorage` / `createJsonlStorage(basePath?)`
- `MemoryStorage` / `createMemoryStorage()`
- `SessionManager` / `createSessionManager(config?)`

### Streaming

第三方集成应以 **`Agent.stream`** 消费流式事件（见 [`sdk-overview.md`](./sdk-overview.md) 第 3 节）。

- `AgentStream`（含 `push` / `end` / `finalize` / `abort` 等；`finalize` 在已推送终端 `end` 后用于结束迭代而不重复发 `end`）
- `createStream()`
- `fromAsyncIterable(iterable)`
- `StreamChunkProcessor`
- 类型：`StreamChunkProcessorOptions`

各 `StreamEvent` 的字段与时机见 [`sdk-types-reference.md`](./sdk-types-reference.md) 第 5 节。

### MCP

- `MCPClient` / `createMCPClient(config)`（`config` 为 `MCPServerConfig`，见 core types）
- `MCPAdapter` / `createMCPAdapter()`
- `loadMCPConfig(configPath?, startDir?, userBasePath?)`
- `validateMCPConfig(config)`
- `formatMcpToolName(serverName, toolName)` / `isMcpPrefixedToolName(name)`：生成或与 Agent 内 **MCP 工具注册名** 一致的字符串（白名单、迁移脚本、与 `disallowedTools` 条目对齐时可用）
- 类型（MCP 连接请统一使用根包 `MCPServerConfig`）：`MCPTool` `MCPResource` `MCPPrompt` `PromptMessage` `MCPConfigFile` `MCPConfigLoadResult`

经 `Agent.connectMCP` 或构造时传入的 `mcpServers` 加载后，MCP 工具在 SDK 内的注册名为 **`mcp__<serverName>__<toolName>`**，其中 `<serverName>` 为 `MCPServerConfig.name`（或与 `mcp_config.json` 里 `mcpServers` 的 key 对应），`<toolName>` 为 MCP 协议返回的工具名。`disallowedTools`、Hook 的 `toolName` 匹配等均使用此注册名（见本文档前文「`disallowedTools`」）。旧版本曾为 `mcp_<serverName>__<toolName>`，升级后若提示词或配置中写死了工具名，需改为新格式。

### Skills 与 Memory

- `SkillLoader` / `createSkillLoader(config?)`
- `SkillRegistry` / `createSkillRegistry(config?)`
- `parseSkillMd(content)`
- `MemoryManager`
- 类型：`SkillLoaderConfig` `MemoryConfig`

### Core Types（根入口 `export * from core/types`）

可直接从 `@ddlqhd/agent-sdk` 导入的核心类型包括：

- 消息与内容：`Message` `MessageRole` `TextContent` `ThinkingContent` `ImageContent` `ContentPart` `ToolCall`
- 模型：`ModelAdapter` `ModelParams` `StreamChunk` `CompletionResult` `ModelCapabilities` `TokenUsage` `SessionTokenUsage`
- 工具：`ToolDefinition` `ToolHandler` `ToolResult` `ToolResultMetadata` `ToolSchema`
- 存储：`StorageConfig` `StorageAdapter` `SessionInfo`
- 流式：`StreamEventType` `StreamEvent` `StreamEventAnnotations`（字段与语义详见 [`sdk-types-reference.md`](./sdk-types-reference.md) 第 5 节）
- MCP：`MCPServerConfig` `MCPResource` `MCPResourceContent` `MCPPrompt` `MCPPromptArgument`
- Skills：`SkillMetadata` `SkillDefinition` `ParsedSkill`
- Agent 配置：`SystemPromptConfig` `SystemPrompt` `ContextManagerConfig` `AgentConfig` `SkillConfig` `AgentCallbacks` `AgentResult`
  - `AgentConfig.subagent` 支持 `enabled/maxDepth/maxParallel/timeoutMs/allowDangerousTools/defaultAllowedTools/subagentTypePrompts`（`subagentTypePrompts` 可按 `general-purpose` / `explore` 覆盖内置追加到子代理 system 的片段，见 [`sdk-integration-recipes.md`](./sdk-integration-recipes.md) §13）
  - `ToolExecutionContext.agentDepth` 用于限制 subagent 嵌套；`ToolExecutionContext.signal` 与 `StreamOptions.signal` 同源，用于协作式取消（见 [`sdk-agent-loop.md`](./sdk-agent-loop.md)）
- CLI 相关导出类型：`CLIConfig` `ChatOptions` `RunOptions` `ToolListOptions` `SessionListOptions` `MCPOptions` `SkillOptions`

上文为常用类型子集；`export *` 另含生命周期回调、窄消息类型、`MODEL_STREAM_EVENT_TYPES` 等，以源码为准。

---

## 2. `@ddlqhd/agent-sdk/models`

适用于只关心模型适配的场景。

### 公开导出

- 工厂：`createModel` `createOpenAI` `createAnthropic` `createOllama`
- `DEFAULT_ADAPTER_CAPABILITIES`（三提供商省略 `capabilities` 时的默认能力，见 [`sdk-types-reference.md`](./sdk-types-reference.md)）
- 适配器类：`OpenAIAdapter` `AnthropicAdapter` `OllamaAdapter`
- 高级导出：`BaseModelAdapter` `zodToJsonSchema` `toolsToModelSchema` `mergeTokenUsage` `ollamaStreamChunksFromChatData` `ollamaMessageContentToApiString`
- 类型：`OpenAIConfig` `AnthropicConfig` `AnthropicRequestMetadata` `AnthropicFetchRetryOptions` `AnthropicThinkingOption` `AnthropicThinkingConfigObject` `AnthropicThinkingEffort` `OllamaConfig` `OllamaThinkOption` `ModelProvider` `CreateModelConfig` `ZodToJsonSchemaOptions`
- 辅助：`applyAnthropicThinking`

> 建议第三方优先使用工厂函数，`BaseModelAdapter` 与 schema 辅助函数偏高级/扩展场景。Anthropic 适配器在未配置 `fetchRetry` 时默认对初次 `POST` **最多尝试 2 次**（约等于 1 次自动重试）；若需关闭重试，传 `fetchRetry: { maxAttempts: 1 }`。

---

## 3. `@ddlqhd/agent-sdk/tools`

适用于“只接工具系统”的场景。

### 公开导出

- 注册与执行：`ToolRegistry` `createTool` `getGlobalRegistry`
- 工具类型：`ToolDefinition` `ToolResult` `ToolSchema` `ToolResultMetadata`
- Hook：同根入口 hooks
- 输出处理：`OutputHandler` `createOutputHandler` `FileStorageStrategy` `PaginationHintStrategy` `SmartTruncateStrategy` `OUTPUT_CONFIG`
- 类型：`OutputStrategy` `ToolExecuteOptions` `ToolRegistryConfig`
- 内置工具：`export * from ./builtin`

> 普通应用只需 `createTool` + `ToolRegistry`；`OutputHandler` 与策略类通常用于 CLI/高级输出治理。

