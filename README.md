# Agent SDK

A TypeScript Agent SDK with multi-model support, MCP integration, skill system, and streaming.

## Features

- 🔄 **Multi-Model Support**: OpenAI, Anthropic, Ollama, and more
- 🔧 **Tool Registration**: 8+ built-in tools + custom tool registration
- 🔌 **MCP Integration**: Connect to MCP servers with stdio/HTTP transport
- 📚 **Skill System**: Load modular skills from SKILL.md files
- 💾 **Session Management**: JSONL-based conversation persistence
- 🧠 **Memory System**: Long-term memory from CLAUDE.md files
- 🌊 **Streaming Output**: AsyncIterable-based real-time streaming
- 🖥️ **CLI Tool**: Command-line interface for quick testing
- 📝 **System Prompt**: Flexible system prompt configuration (replace/append modes)

## Installation

```bash
npm install agent-sdk
# or
pnpm add agent-sdk
```

## Model Configuration

**Integration policy:** Application code must drive execution through **`Agent`** (`run` / `stream`). Use `createOpenAI`, `createAnthropic`, `createOllama`, or `createModel` only to build the `model` passed into `Agent`. Do **not** call `ModelAdapter` methods such as `stream()` or `complete()` directly in product code (bypassing `Agent`). See `docs/sdk-overview.md` section 3.

SDK 支持两种配置方式：**环境变量** 和 **代码配置**。

### 方式一：环境变量

```bash
# OpenAI
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_ORG_ID=org-xxx

# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_BASE_URL=https://api.anthropic.com

# Ollama (本地模型)
OLLAMA_BASE_URL=http://localhost:11434
```

### 方式二：代码配置

```typescript
import { createOpenAI, createAnthropic, createOllama } from 'agent-sdk';

// OpenAI - 支持自定义 baseUrl 用于兼容 API (如 Azure OpenAI、代理等)
const openai = createOpenAI({
  apiKey: 'sk-xxx',
  baseUrl: 'https://api.openai.com/v1',  // 可选，支持第三方兼容 API
  model: 'gpt-4o'                        // 可选，默认 'gpt-4o'
});

// Anthropic
const anthropic = createAnthropic({
  apiKey: 'sk-ant-xxx',
  baseUrl: 'https://api.anthropic.com',  // 可选
  model: 'claude-sonnet-4-20250514'      // 可选，默认 'claude-sonnet-4-20250514'
});

// Ollama (本地模型，无需 apiKey)
const ollama = createOllama({
  baseUrl: 'http://localhost:11434',     // 可选，默认 'http://localhost:11434'
  model: 'llama3'                        // 可选，默认 'llama3'
});
```

### 优先级

**代码配置 > 环境变量 > 默认值**

```typescript
// 例如 OpenAI 的配置优先级：
this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
this.baseUrl = config.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
```

### 支持的配置项

| Provider | 环境变量 | 配置项 | 默认值 |
|----------|----------|--------|--------|
| OpenAI | `OPENAI_API_KEY` | `apiKey` | - |
| OpenAI | `OPENAI_BASE_URL` | `baseUrl` | `https://api.openai.com/v1` |
| OpenAI | `OPENAI_ORG_ID` | `organization` | - |
| Anthropic | `ANTHROPIC_API_KEY` | `apiKey` | - |
| Anthropic | `ANTHROPIC_BASE_URL` | `baseUrl` | `https://api.anthropic.com` |
| Ollama | `OLLAMA_BASE_URL` | `baseUrl` | `http://localhost:11434` |

## System Prompt Configuration

SDK 内置了完整的 Agent 系统提示词，描述了 Agent 的能力（Tools、Skills、Sessions 等）。你可以：

### 使用默认系统提示词

```typescript
// 不传 systemPrompt，使用内置默认提示词
const agent = new Agent({ model });
```

### 追加自定义内容 (默认行为)

```typescript
// 简单字符串 - 追加到默认提示词后面
const agent = new Agent({
  model,
  systemPrompt: '你擅长中文回答，并且总是给出详细的代码示例'
});

// 配置对象 - 明确指定 append 模式
const agent = new Agent({
  model,
  systemPrompt: {
    content: '你擅长中文回答',
    mode: 'append'  // 可省略，默认 append
  }
});
```

### 替换默认提示词

```typescript
// 完全替换内置提示词
const agent = new Agent({
  model,
  systemPrompt: {
    content: '你是自定义助手...',
    mode: 'replace'
  }
});
```

### 运行时动态修改

```typescript
const agent = new Agent({ model });

// 替换系统提示
agent.setSystemPrompt({
  content: '新的系统提示',
  mode: 'replace'
});

// 追加内容
agent.appendSystemPrompt('额外的指令');

// 获取当前系统提示
const currentPrompt = agent.getSystemPrompt();
```

### 内置系统提示词内容

默认系统提示词包含：
- **Tools 使用指南**: 文件操作、代码执行、Web 访问等
- **Skills 说明**: 如何加载和使用 Skills
- **Sessions 说明**: 会话管理和上下文保持
- **任务执行原则**: 简洁、直接、读后再改等
- **输出格式**: 代码块、引用格式等
- **安全指南**: 输入验证、权限控制等

## Memory System

SDK 支持从 CLAUDE.md 文件加载长期记忆，让 Agent 在每次对话开始时自动获取上下文信息。

### 记忆文件位置

默认情况下，SDK 会从以下位置加载记忆：

1. **用户主目录**: `~/.claude/CLAUDE.md` - 适用于所有项目的个人偏好
2. **工作空间根目录**: `./.claude/CLAUDE.md` - 项目特定的规则和上下文

### 启用记忆 (默认开启)

```typescript
import { Agent, createOpenAI } from 'agent-sdk';

// 默认启用记忆
const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
});

// 记忆内容会自动添加到用户消息前
const result = await agent.run('Help me with this code');
```

### 禁用记忆

```typescript
const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  memory: false  // 禁用记忆功能
});
```

### 自定义记忆路径

```typescript
import { Agent, createOpenAI, MemoryManager } from 'agent-sdk';
import type { MemoryConfig } from 'agent-sdk';

const memoryConfig: MemoryConfig = {
  userHomePath: '/custom/path/user-memory.md',    // 可选
  workspacePath: '/custom/path/project-memory.md' // 可选
};

const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  memory: true,
  memoryConfig
});
```

### 记忆文件格式

记忆内容会被包裹在 `<system-minder>` 标签中：

```markdown
<system-minder>
# User Memory

你的个人偏好和规则...

# Workspace Memory

项目特定的规则和上下文...
</system-minder>
```

### 直接使用 MemoryManager

```typescript
import { MemoryManager } from 'agent-sdk';

// 使用默认路径
const manager = new MemoryManager();
const memory = manager.loadMemory();

// 使用自定义路径
const manager = new MemoryManager('/workspace/root', {
  userHomePath: '/custom/user-memory.md',
  workspacePath: '/custom/project-memory.md'
});

// 检查记忆文件是否存在
const { userHome, workspace } = manager.checkMemoryFiles();
```

## Quick Start

### Basic Usage

```typescript
import { Agent, createOpenAI } from 'agent-sdk';

// Create an agent with OpenAI
const agent = new Agent({
  model: createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o'
  }),
  systemPrompt: 'You are a helpful assistant.'
});

// Stream response
for await (const event of agent.stream('Hello!')) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.content);
  }
}
```

### With Custom Tools

```typescript
import { Agent, createTool, createOpenAI } from 'agent-sdk';
import { z } from 'zod';

const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
});

// Register a custom tool
agent.registerTool(createTool({
  name: 'get_weather',
  description: 'Get weather information for a city',
  parameters: z.object({
    city: z.string().describe('City name')
  }),
  handler: async ({ city }) => ({
    content: `Weather in ${city}: Sunny, 25°C`
  })
}));

const result = await agent.run('What is the weather in Tokyo?');
console.log(result.content);
```

### With MCP Servers

```typescript
import { Agent, createOpenAI, MCPServers } from 'agent-sdk';

const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
});

// Connect to MCP server
await agent.connectMCP(MCPServers.filesystem(['/path/to/allowed/dir']));

const result = await agent.run('List files in the current directory');
console.log(result.content);
```

### With Skills

```typescript
import { Agent, createOpenAI } from 'agent-sdk';

const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  skills: ['./skills/code-review']
});

const result = await agent.run('Review this code for best practices');
console.log(result.content);
```

### Session Management

```typescript
import { Agent, createOpenAI } from 'agent-sdk';

const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  storage: { type: 'jsonl', basePath: './sessions' }
});

// First conversation
const result1 = await agent.run('My name is Alice', { sessionId: 'user-123' });

// Resume the same session later
const result2 = await agent.run('What is my name?', { sessionId: 'user-123' });
console.log(result2.content); // "Your name is Alice"
```

## CLI Usage

### 本地开发

项目自带 CLI 工具，先确保已构建：

```bash
pnpm build
```

然后通过 `node` 直接运行：

```bash
# 查看帮助
node dist/cli/index.js --help

# 交互式聊天
node dist/cli/index.js chat --model openai --api-key sk-xxx

# 单次提问
node dist/cli/index.js run "What is the capital of France?" --model openai

# 列出可用工具
node dist/cli/index.js tools list

# 列出会话
node dist/cli/index.js sessions list

# 连接 MCP 服务器
node dist/cli/index.js mcp connect "npx @modelcontextprotocol/server-filesystem /path"
```

也可以在 `package.json` 中添加便捷脚本：

```json
"scripts": {
  "cli": "node dist/cli/index.js"
}
```

然后使用 `pnpm cli tools list`。

### 作为全局/项目依赖安装

如果从 npm 安装（`npm install -g agent-sdk`），可直接使用 `agent-sdk` 命令。在项目内通过 `npx` 调用：

```bash
npx agent-sdk --help

# 聊天模式
npx agent-sdk chat --model openai --api-key sk-xxx

# 单次运行
npx agent-sdk run "List files in current directory" --model openai

# 工具管理
npx agent-sdk tools list
npx agent-sdk tools info Read

# 会话管理
npx agent-sdk sessions list
npx agent-sdk sessions show <session-id>
npx agent-sdk sessions delete <session-id>

# MCP 管理
npx agent-sdk mcp list
npx agent-sdk mcp connect "npx @modelcontextprotocol/server-filesystem /path"
npx agent-sdk mcp disconnect <server-name>
```

### CLI 命令参考

#### chat

启动交互式聊天会话。

```bash
agent-sdk chat [options]

选项:
  -m, --model <model>      模型提供商 (openai, anthropic, ollama)
  -k, --api-key <key>      API Key
  -u, --base-url <url>     基础 URL
  -M, --model-name <name>  模型名称
  -t, --temperature <num>  温度 (0-2)
  --max-tokens <num>       最大 Token 数
  -s, --session <id>       会话 ID
  -S, --system <prompt>    系统提示词
  --no-stream              禁用流式输出
  -v, --verbose            显示完整的工具调用参数和结果（调试模式）
  --mcp-config <path>      MCP 配置文件路径
  --user-base-path <path>  用户基础路径 (默认: ~)
  --cwd <path>             工作目录 (默认: 当前目录)
```

#### run

单次运行并输出结果。

```bash
agent-sdk run <prompt> [options]

选项:
  -m, --model <model>      模型提供商
  -k, --api-key <key>      API Key
  -o, --output <format>    输出格式 (text, json)
  -v, --verbose            显示完整的工具调用参数和结果（调试模式）
  (其他选项同 chat)
```

#### tools

管理工具列表。

```bash
agent-sdk tools list [options]     # 列出所有可用工具
agent-sdk tools info <tool-name>   # 查看工具详情

选项:
  -f, --format <format>  输出格式 (table, json)
```

#### sessions

管理会话历史。

```bash
agent-sdk sessions list [options]    # 列出所有会话
agent-sdk sessions show <id>         # 查看会话内容
agent-sdk sessions delete <id>       # 删除会话

选项:
  -f, --format <format>  输出格式 (table, json)
  -l, --limit <num>      限制数量
```

#### mcp

管理 MCP 服务器连接。

```bash
agent-sdk mcp list                     # 列出已连接的 MCP 服务器
agent-sdk mcp connect <command>        # 连接 MCP 服务器
agent-sdk mcp disconnect <name>        # 断开 MCP 服务器
```

## API Reference

### Agent

```typescript
class Agent {
  constructor(config: AgentConfig);

  // Stream response
  stream(input: string, options?: StreamOptions): AsyncIterable<StreamEvent>;

  // Complete response
  run(input: string, options?: StreamOptions): Promise<AgentResult>;

  // Tool registration
  registerTool(tool: ToolDefinition): void;
  registerTools(tools: ToolDefinition[]): void;
  getToolRegistry(): ToolRegistry;

  // Session management
  getSessionManager(): SessionManager;

  // Message history
  getMessages(): Message[];
  clearMessages(): void;

  // System prompt
  setSystemPrompt(prompt: SystemPrompt): void;
  appendSystemPrompt(content: string): void;
  getSystemPrompt(): string | undefined;

  // Skills
  loadSkill(path: string): Promise<void>;
  getSkillRegistry(): SkillRegistry;

  // MCP
  connectMCP(config: MCPServerConfig): Promise<void>;
  disconnectMCP(name: string): Promise<void>;
  disconnectAllMCP(): Promise<void>;
  getMCPAdapter(): MCPAdapter | null;

  // Lifecycle
  waitForInit(): Promise<void>;
  destroy(): Promise<void>;
}
```

### Models

```typescript
// OpenAI - 支持自定义 baseUrl 用于兼容 API
createOpenAI(config?: {
  apiKey?: string;      // 默认：process.env.OPENAI_API_KEY
  baseUrl?: string;     // 默认：https://api.openai.com/v1
  model?: string;       // 默认：'gpt-4o'
  organization?: string // 默认：process.env.OPENAI_ORG_ID
}): ModelAdapter

// Anthropic
createAnthropic(config?: {
  apiKey?: string;      // 默认：process.env.ANTHROPIC_API_KEY
  baseUrl?: string;     // 默认：https://api.anthropic.com
  model?: string;       // 默认：'claude-sonnet-4-20250514'
}): ModelAdapter

// Ollama (local)
createOllama(config?: {
  baseUrl?: string;     // 默认：http://localhost:11434
  model?: string;       // 默认：'llama3'
}): ModelAdapter

// Generic factory
createModel(config: {
  provider: 'openai' | 'anthropic' | 'ollama';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): ModelAdapter
```

### Tools

```typescript
// Create custom tool
createTool(config: {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  handler: (args: any) => Promise<ToolResult>;
  isDangerous?: boolean;
  category?: string;
}): ToolDefinition

// Tool registry
class ToolRegistry {
  register(tool: ToolDefinition): void;
  unregister(name: string): boolean;
  execute(name: string, args: unknown): Promise<ToolResult>;
  getAll(): ToolDefinition[];
}

// Get global registry (singleton)
getGlobalRegistry(): ToolRegistry

// Built-in tools
getAllBuiltinTools(skillRegistry: SkillRegistry): ToolDefinition[]
getSafeBuiltinTools(skillRegistry: SkillRegistry): ToolDefinition[] // 不含危险操作
```

创建 `Agent` 时可在 **`AgentConfig.tools`** 中传入与内置**同名**（如 `Read`）的 `ToolDefinition`，用于**替换**该内置工具的默认实现。若工具名出现在 **`disallowedTools`** 中，则内置与你的自定义都不会注册，因此不要用 `disallowedTools` 来“关掉”内置再替换。仅需完全自建工具表时，使用 **`exclusiveTools`**。更完整的字段说明见 [`docs/sdk-api-reference.md`](docs/sdk-api-reference.md)；示例见 [`docs/sdk-integration-recipes.md`](docs/sdk-integration-recipes.md) 第 3 节。

### Storage

```typescript
// JSONL storage (persistent)
createJsonlStorage(basePath?: string): StorageAdapter

// Memory storage (testing)
createMemoryStorage(): StorageAdapter

// Generic factory
createStorage(config: StorageConfig): StorageAdapter

interface StorageConfig {
  type: 'jsonl' | 'memory';
  basePath?: string;
}

// Session manager
class SessionManager {
  constructor(storage?: StorageAdapter);
  
  createSession(id?: string): string;
  resumeSession(id: string): Promise<Message[]>;
  saveMessages(messages: Message[]): Promise<void>;
  loadMessages(): Promise<Message[]>;
  listSessions(): Promise<SessionInfo[]>;
  deleteSession(id: string): Promise<void>;
  getSessionId(): string | undefined;
}

interface SessionInfo {
  id: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}
```

### MCP

```typescript
// Create MCP client
createMCPClient(config: MCPClientConfig): MCPClient

interface StdioMCPConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface HttpMCPConfig {
  name: string;
  url: string;
  headers?: Record<string, string>;
}

type MCPClientConfig = StdioMCPConfig | HttpMCPConfig;

class MCPClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getTools(): MCPTool[];
  getPrompts(): MCPPrompt[];
  getResources(): MCPResource[];
}

// MCP adapter (for Agent integration)
class MCPAdapter {
  addServer(config: MCPClientConfig): Promise<void>;
  removeServer(name: string): Promise<void>;
  disconnectAll(): Promise<void>;
  getToolDefinitions(): ToolDefinition[];
}

// Load MCP config from file (Claude Desktop compatible)
loadMCPConfig(configPath?: string, startDir?: string): MCPConfigLoadResult
validateMCPConfig(config: MCPConfigFile): string[]

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

### Skills

```typescript
// Load skill from path
class SkillLoader {
  constructor(config?: SkillLoaderConfig);
  load(path: string): Promise<SkillDefinition>;
}

interface SkillLoaderConfig {
  userHomePath?: string;   // Default: ~/.claude/skills/
  workspacePath?: string;  // Default: ./.claude/skills/
}

createSkillLoader(config?: SkillLoaderConfig): SkillLoader

// Skill registry
class SkillRegistry {
  register(skill: SkillDefinition): void;
  load(path: string): Promise<void>;
  loadAll(paths: string[]): Promise<void>;
  getFormattedList(): string;
}

createSkillRegistry(): SkillRegistry

// Parse SKILL.md file
parseSkillMd(content: string): ParsedSkill

interface SkillDefinition {
  metadata: SkillMetadata;
  path: string;
  instructions: string;
}

interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  author?: string;
  dependencies?: string[];
  tags?: string[];
}
```

### Memory

```typescript
// Memory manager
class MemoryManager {
  constructor(workspaceRoot?: string, config?: MemoryConfig);

  // Load memory content from both locations
  loadMemory(): string;

  // Check if memory files exist
  checkMemoryFiles(): { userHome: boolean; workspace: boolean };
}

interface MemoryConfig {
  userHomePath?: string;   // Default: ~/.claude/CLAUDE.md
  workspacePath?: string;  // Default: ./.claude/CLAUDE.md
}
```

### Streaming

Model adapters yield `StreamChunk` values. The library normalizes them to `StreamEvent` using `StreamChunkProcessor` within `Agent.stream()`.

Optional fields on every event (when produced by `Agent.stream()`): `streamEventId`, `iteration`, `sessionId` (`StreamEventAnnotations`).

`StreamOptions` / `ModelParams` support `includeRawStreamEvents?: boolean`. When set, adapters attach `providerRaw` on each chunk (e.g. the parsed Anthropic SSE JSON object).

```typescript
// Stream event types (each may also include StreamEventAnnotations)
type StreamEvent =
  | { type: 'start'; timestamp: number }
  | { type: 'text_start'; content?: string }
  | { type: 'text_delta'; content: string }
  | { type: 'text_end'; content?: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; arguments: string }
  | { type: 'tool_call'; id: string; name: string; arguments: unknown }
  | { type: 'tool_call_end'; id: string }
  | { type: 'tool_result'; toolCallId: string; result: string }
  | { type: 'tool_error'; toolCallId: string; error: Error }
  | { type: 'thinking'; content: string; signature?: string }
  | { type: 'metadata'; data: Record<string, unknown> }
  | {
      type: 'context_compressed';
      stats: { originalMessageCount: number; compressedMessageCount: number; durationMs: number };
    }
  | {
      type: 'end';
      timestamp: number;
      usage?: TokenUsage;
      reason?: 'complete' | 'aborted' | 'error';
      error?: Error;
      partialContent?: string;
    };

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Tool failures: Agent emits `tool_error` first, then `tool_result` with `Error: …` content (backward compatible).

// Stream utilities
class AgentStream { /* AsyncIterable<StreamEvent>, push/end/collectText/… */ }

class StreamChunkProcessor {
  processChunk(chunk: StreamChunk): StreamEvent[];
  flush(): StreamEvent[];
  getUsage(): TokenUsage | undefined;
}
```

**Rough mapping to Claude Agent SDK streaming** (see Anthropic docs for `includePartialMessages`):

| Claude API / Agent SDK (partial) | agent-sdk `StreamEvent` |
|----------------------------------|-------------------------|
| `content_block_start` (text)     | `text_start` (before first `text_delta`) |
| `content_block_delta` / `text_delta` | `text_delta` |
| `content_block_stop` (text)      | `text_end` |
| `content_block_start` (tool_use)   | `tool_call_start` |
| `content_block_delta` / `input_json_delta` | `tool_call_delta` |
| `content_block_stop` (tool_use)  | `tool_call_end` then `tool_call` |
| User/tool result turn            | `tool_result` (+ optional `tool_error`) |
| Session / correlation            | `sessionId`, `streamEventId`, `iteration` on events |
| History compacted                | `context_compressed` |
| Raw SSE record                   | `StreamChunk.providerRaw` when `includeRawStreamEvents` |

## Project Structure

```
agent-sdk/
├── src/
│   ├── core/              # Agent core, types, prompts
│   │   ├── agent.ts       # Agent class implementation
│   │   ├── types.ts       # Type definitions
│   │   └── prompts.ts     # System prompt templates
│   ├── models/            # Model adapters
│   │   ├── base.ts        # Base adapter with utilities
│   │   ├── openai.ts      # OpenAI adapter
│   │   ├── anthropic.ts   # Anthropic adapter
│   │   └── ollama.ts      # Ollama adapter
│   ├── tools/             # Tool system
│   │   ├── registry.ts    # Tool registry
│   │   └── builtin/       # Built-in tools
│   │       ├── filesystem.ts
│   │       ├── shell.ts
│   │       ├── grep.ts
│   │       ├── web.ts
│   │       ├── planning.ts
│   │       ├── interaction.ts
│   │       └── skill-activation.ts
│   ├── storage/           # Storage adapters
│   │   ├── session.ts     # Session manager (JSONL)
│   │   └── memory.ts      # Memory storage
│   ├── streaming/         # Streaming system
│   │   ├── event-emitter.ts
│   │   └── chunk-processor.ts
│   ├── mcp/               # MCP integration
│   │   ├── client.ts      # MCP client
│   │   └── adapter.ts     # MCP adapter for Agent
│   ├── skills/            # Skill system
│   │   ├── loader.ts      # Skill loader
│   │   ├── registry.ts    # Skill registry
│   │   └── parser.ts      # SKILL.md parser
│   ├── memory/            # Memory system
│   │   └── manager.ts     # CLAUDE.md loader
│   ├── config/            # Configuration
│   │   └── mcp-config.ts  # MCP config loader
│   ├── cli/               # Command-line interface
│   │   ├── index.ts       # CLI entry point
│   │   └── commands/      # CLI commands
│   │       ├── chat.ts
│   │       ├── tools.ts
│   │       ├── sessions.ts
│   │       └── mcp.ts
│   └── index.ts           # Main entry point
├── tests/                 # Unit and integration tests
├── examples/              # Usage examples
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

## Built-in Tools

SDK 提供以下内置工具（名称与 `ToolDefinition.name` 一致，供 CLI `tools info <name>` 使用）：

### 文件系统 (filesystem)
| Tool | Description | Dangerous |
|------|-------------|-----------|
| `Read` | Read file contents (line-numbered, offset/limit) | ❌ |
| `Write` | Create or overwrite a file | ❌ |
| `Edit` | Exact string replace in a file | ❌ |
| `Glob` | Find files by glob pattern | ❌ |

### Shell 命令 (shell)
| Tool | Description | Dangerous |
|------|-------------|-----------|
| `Bash` | Run shell command | ✅ |

### 搜索 (grep)
| Tool | Description | Dangerous |
|------|-------------|-----------|
| `Grep` | Ripgrep-based content search | ❌ |

### Web 访问 (web)
| Tool | Description | Dangerous |
|------|-------------|-----------|
| `WebFetch` | Fetch URL and return readable markdown | ❌ |
| `WebSearch` | Web search via Tavily when `TAVILY_API_KEY` is set; otherwise not configured | ❌ |

### 任务列表 (task)
| Tool | Description | Dangerous |
|------|-------------|-----------|
| `TaskCreate` | Create a session task | ❌ |
| `TaskUpdate` | Update or complete a task | ❌ |
| `TaskList` | List tasks | ❌ |

### 交互 (interaction)
| Tool | Description | Dangerous |
|------|-------------|-----------|
| `AskUserQuestion` | Ask the user structured questions | ❌ |

### Skill (skill-activation)
| Tool | Description | Dangerous |
|------|-------------|-----------|
| `Skill` | Invoke a registered skill by name | ❌ |

### Subagent (subagent)
| Tool | Description | Dangerous |
|------|-------------|-----------|
| `Agent` | Delegate work to a subagent with isolated context | ❌ |

> **Dangerous** 对应源码中的 `isDangerous`；当前仅 **Bash** 为 `true`。`getSafeBuiltinTools` 会排除此类工具。
>
> Subagent 约束：`Agent` 工具默认禁止嵌套调用（子代理不会再暴露 `Agent` 工具），并可通过 `AgentConfig.subagent` 配置并发、超时和权限策略。

## Module Exports

SDK 提供以下模块导出：

```typescript
// Main entry point
import { Agent, createAgent } from 'agent-sdk';

// Models sub-module
import { createOpenAI, createAnthropic, createOllama } from 'agent-sdk/models';

// Tools sub-module
import { createTool, ToolRegistry } from 'agent-sdk/tools';
```

完整的导出列表：

### Main (`agent-sdk`)
- **Agent**: `Agent`, `createAgent`
- **Types**: `StreamOptions`, all types from `core/types.js`
- **Prompts**: `DEFAULT_SYSTEM_PROMPT`
- **Models**: `createModel`, `createOpenAI`, `createAnthropic`, `createOllama`, adapters
- **Tools**: `ToolRegistry`, `createTool`, `getGlobalRegistry`, all built-in tools
- **Storage**: `createStorage`, `JsonlStorage`, `MemoryStorage`, `SessionManager`
- **Streaming**: `AgentStream`, `createStream`, `fromAsyncIterable`, `StreamChunkProcessor`
- **MCP**: `MCPClient`, `MCPAdapter`, `createMCPClient`, `createMCPAdapter`
- **Skills**: `SkillLoader`, `SkillRegistry`, `createSkillLoader`, `createSkillRegistry`, `parseSkillMd`
- **Memory**: `MemoryManager`
- **Config**: `loadMCPConfig`, `validateMCPConfig`

### Models (`agent-sdk/models`)
- `createModel`, `createOpenAI`, `createAnthropic`, `createOllama`
- `OpenAIAdapter`, `AnthropicAdapter`, `OllamaAdapter`
- Types: `OpenAIConfig`, `AnthropicConfig`, `OllamaConfig`, `ModelProvider`, `CreateModelConfig`

### Tools (`agent-sdk/tools`)
- `ToolRegistry`, `createTool`, `getGlobalRegistry`
- Types: `ToolDefinition`, `ToolResult`, `ToolSchema`

## License

MIT
