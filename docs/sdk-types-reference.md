# Agent SDK 类型定义参考

本页聚焦第三方集成最常用、最关键的公开类型。

## 1. Agent 相关

## `AgentConfig`

```ts
interface AgentConfig {
  model: ModelAdapter;
  systemPrompt?: SystemPrompt;
  tools?: ToolDefinition[];
  skills?: string[];
  mcpServers?: MCPServerConfig[];
  userBasePath?: string;
  storage?: StorageConfig;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
  sessionId?: string;
  callbacks?: AgentCallbacks;
  memory?: boolean;
  memoryConfig?: MemoryConfig;
  skillConfig?: SkillConfig;
  contextManagement?: boolean | ContextManagerConfig;
  cwd?: string;
  includeEnvironment?: boolean;
  hookManager?: HookManager;
  hookConfigDir?: string;
  subagent?: {
    enabled?: boolean;
    maxDepth?: number;
    maxParallel?: number;
    timeoutMs?: number;
    allowDangerousTools?: boolean;
    defaultAllowedTools?: string[];
  };
}
```

与工具相关的常用字段（完整列表以源码 `AgentConfig` 为准）：

- **`tools`**：在默认内置之后注册；**与内置 `name` 相同时会替换内置定义**（见 [`sdk-api-reference.md`](./sdk-api-reference.md)「替换内置工具」）。
- **`disallowedTools`**：按注册名禁止；被禁止的名不会注册内置，且 `tools` 中同名项也会被跳过。
- **`allowedTools`** / **`canUseTool`**：自动批准与人工审批策略。
- **`exclusiveTools`**：仅使用此处列出的工具，不合并默认内置。

## `AgentResult`

```ts
interface AgentResult {
  content: string;
  toolCalls?: Array<{ name: string; arguments: unknown; result: string }>;
  usage?: TokenUsage;
  sessionId: string;
  iterations: number;
}
```

## `StreamOptions`

```ts
interface StreamOptions {
  sessionId?: string;
  systemPrompt?: SystemPrompt;
  signal?: AbortSignal;
  includeRawStreamEvents?: boolean;
}
```

## 2. 消息与内容

## `Message` / `ToolCall`

```ts
interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  timestamp?: number;
}
```

## `ContentPart`

```ts
type ContentPart = TextContent | ThinkingContent | ImageContent;
```

- `TextContent`: `{ type: 'text'; text: string }`
- `ThinkingContent`: `{ type: 'thinking'; thinking: string; signature?: string }`
- `ImageContent`: `{ type: 'image'; imageUrl: string; mimeType?: string }`

## 3. 模型层类型

## `ModelAdapter`

```ts
interface ModelAdapter {
  name: string;
  capabilities?: ModelCapabilities;
  stream(params: ModelParams): AsyncIterable<StreamChunk>;
  complete(params: ModelParams): Promise<CompletionResult>;
}
```

## `ModelParams`

```ts
interface ModelParams {
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  signal?: AbortSignal;
  includeRawStreamEvents?: boolean;
}
```

## `CompletionResult` / `TokenUsage`

```ts
interface CompletionResult {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  metadata?: Record<string, unknown>;
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```

## 4. 工具层类型

## `ToolDefinition`

```ts
interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  handler: ToolHandler;
  isDangerous?: boolean;
  category?: string;
}
```

## `ToolResult`

```ts
interface ToolResult {
  content: string;
  isError?: boolean;
  metadata?: ToolResultMetadata;
}
```

## `ToolExecutionContext`

```ts
interface ToolExecutionContext {
  toolCallId?: string;
  projectDir?: string;
  agentDepth?: number;
}
```

## 5. Streaming 事件类型

## `StreamEvent`

`StreamEvent` 是联合类型，常见事件：

- `start`
- `text_start` / `text_delta` / `text_end`
- `tool_call_start` / `tool_call_delta` / `tool_call` / `tool_call_end`
- `tool_result` / `tool_error`
- `thinking`
- `metadata`
- `context_compressed`
- `end`
- `error`

所有事件都可能带有注解字段（可观测性）：

```ts
interface StreamEventAnnotations {
  streamEventId?: string;
  iteration?: number;
  sessionId?: string;
}
```

## 6. MCP 类型

## `MCPServerConfig`

```ts
interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}
```

## `MCPConfigFile`

```ts
interface MCPConfigFile {
  mcpServers: {
    [name: string]: {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
    };
  };
}
```

## 7. Skills 与 Memory 类型

## `SkillMetadata` / `SkillDefinition`

```ts
interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  author?: string;
  dependencies?: string[];
  tags?: string[];
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
}

interface SkillDefinition {
  metadata: SkillMetadata;
  path: string;
  instructions: string;
}
```

## `MemoryConfig` / `SkillConfig`

```ts
interface MemoryConfig {
  workspacePath?: string;
}

interface SkillConfig {
  autoLoad?: boolean;
  workspacePath?: string;
  additionalPaths?: string[];
}
```

## 8. 存储类型

```ts
interface StorageConfig {
  type: 'jsonl' | 'memory';
}

interface StorageAdapter {
  save(sessionId: string, messages: Message[]): Promise<void>;
  load(sessionId: string): Promise<Message[]>;
  list(): Promise<SessionInfo[]>;
  delete(sessionId: string): Promise<void>;
  exists(sessionId: string): Promise<boolean>;
}
```

`SessionInfo`:

```ts
interface SessionInfo {
  id: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  metadata?: Record<string, unknown>;
}
```

## 9. CLI 类型（已公开，但偏 CLI 语义）

根入口也导出了：

- `CLIConfig`
- `ChatOptions`
- `RunOptions`
- `ToolListOptions`
- `SessionListOptions`
- `MCPOptions`
- `SkillOptions`

这些类型主要用于 CLI 集成，不建议在纯业务 SDK 接口层强耦合。

