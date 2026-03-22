# Agent SDK

A TypeScript Agent SDK with multi-model support, MCP integration, skill system, and streaming.

## Features

- 🔄 **Multi-Model Support**: OpenAI, Anthropic, Ollama, and more
- 🔧 **Tool Registration**: Built-in tools + custom tool registration
- 🔌 **MCP Integration**: Connect to MCP servers for extended capabilities
- 📚 **Skill System**: Load modular skills from SKILL.md files
- 💾 **Session Management**: JSONL-based conversation persistence
- 🌊 **Streaming Output**: AsyncIterable-based real-time streaming
- 🖥️ **CLI Tool**: Command-line interface for quick testing

## Installation

```bash
npm install agent-sdk
# or
pnpm add agent-sdk
```

## Model Configuration

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

```bash
# Interactive chat
agent-sdk chat --model openai --api-key sk-xxx

# Single prompt
agent-sdk run "What is the capital of France?" --model openai

# List available tools
agent-sdk tools list

# List sessions
agent-sdk sessions list

# Connect to MCP server
agent-sdk mcp connect "npx @modelcontextprotocol/server-filesystem /path"
```

## API Reference

### Agent

```typescript
class Agent {
  constructor(config: AgentConfig);
  
  // Stream response
  stream(input: string, options?: StreamOptions): AsyncIterable<StreamEvent>;
  
  // Complete response
  run(input: string, options?: RunOptions): Promise<AgentResult>;
  
  // Tool registration
  registerTool(tool: ToolDefinition): void;
  registerTools(tools: ToolDefinition[]): void;
  
  // Session management
  getSessionManager(): SessionManager;
  
  // Message history
  getMessages(): Message[];
  clearMessages(): void;
}
```

### Models

```typescript
// OpenAI
createOpenAI({ apiKey?, baseUrl?, model? }): ModelAdapter

// Anthropic
createAnthropic({ apiKey?, baseUrl?, model? }): ModelAdapter

// Ollama (local)
createOllama({ baseUrl?, model? }): ModelAdapter

// Generic factory
createModel({ provider, apiKey?, baseUrl?, model? }): ModelAdapter
```

### Tools

```typescript
// Create custom tool
createTool({
  name: string,
  description: string,
  parameters: ZodSchema,
  handler: (args) => Promise<ToolResult>
}): ToolDefinition

// Tool registry
class ToolRegistry {
  register(tool: ToolDefinition): void;
  unregister(name: string): boolean;
  execute(name: string, args: unknown): Promise<ToolResult>;
  getAll(): ToolDefinition[];
}
```

### Storage

```typescript
// JSONL storage (persistent)
createJsonlStorage({ basePath? }): StorageAdapter

// Memory storage (testing)
createMemoryStorage(): StorageAdapter

// Session manager
class SessionManager {
  createSession(id?): string;
  resumeSession(id): Promise<Message[]>;
  saveMessages(messages): Promise<void>;
  loadMessages(): Promise<Message[]>;
  listSessions(): Promise<SessionInfo[]>;
}
```

### MCP

```typescript
// Create MCP client
createMCPClient({
  name: string,
  transport: 'stdio' | 'http',
  command?: string,
  args?: string[],
  url?: string
}): MCPClient

// Preset servers
MCPServers.filesystem(dirs)
MCPServers.git(repoPath)
MCPServers.sqlite(dbPath)
MCPServers.braveSearch(apiKey?)
MCPServers.puppeteer()
```

### Skills

```typescript
// Load skill from path
const loader = createSkillLoader();
const skill = await loader.load('./skills/my-skill');

// Skill registry
const registry = createSkillRegistry();
await registry.loadAll('./skills');
registry.register(skill);
```

## Project Structure

```
agent-sdk/
├── src/
│   ├── core/          # Agent core, types
│   ├── models/        # Model adapters (OpenAI, Anthropic, Ollama)
│   ├── tools/         # Tool registry, built-in tools
│   ├── storage/       # JSONL/Memory storage
│   ├── streaming/     # Streaming event system
│   ├── mcp/           # MCP client integration
│   ├── skills/        # Skill loader and registry
│   ├── cli/           # Command-line interface
│   └── index.ts       # Main entry point
├── tests/             # Unit and integration tests
├── examples/          # Usage examples
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

## Built-in Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Write to a file |
| `list_files` | List directory contents |
| `delete_file` | Delete a file |
| `file_exists` | Check if file exists |
| `execute_command` | Run shell command |
| `run_python` | Execute Python code |
| `run_node` | Execute Node.js code |
| `http_request` | Make HTTP request |
| `fetch_webpage` | Fetch webpage content |
| `download_file` | Download a file |

## License

MIT
