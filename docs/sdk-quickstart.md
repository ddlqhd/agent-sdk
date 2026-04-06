# Agent SDK 快速开始

## 1. 安装

```bash
npm install @ddlqhd/agent-sdk
# 或
pnpm add @ddlqhd/agent-sdk
```

## 2. 环境变量与代码配置

**优先级**：**代码参数 > 环境变量 > SDK 默认值**。

### 环境变量示例

```bash
# OpenAI
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_ORG_ID=org-xxx

# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_BASE_URL=https://api.anthropic.com

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
```

### 提供商与配置项对照

| Provider | 环境变量 | 配置项（工厂函数） | 默认值（节选） |
|----------|----------|-------------------|----------------|
| OpenAI | `OPENAI_API_KEY` | `apiKey` | - |
| OpenAI | `OPENAI_BASE_URL` | `baseUrl` | `https://api.openai.com/v1` |
| OpenAI | `OPENAI_ORG_ID` | `organization` | - |
| Anthropic | `ANTHROPIC_API_KEY` | `apiKey` | - |
| Anthropic | `ANTHROPIC_BASE_URL` | `baseUrl` | `https://api.anthropic.com` |
| Ollama | `OLLAMA_BASE_URL` | `baseUrl` | `http://localhost:11434` |

### 代码中传入工厂函数

```ts
import { createOpenAI, createAnthropic, createOllama } from '@ddlqhd/agent-sdk';

const openai = createOpenAI({
  apiKey: 'sk-xxx',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o'
});

const anthropic = createAnthropic({
  apiKey: 'sk-ant-xxx',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-20250514'
});

const ollama = createOllama({
  baseUrl: 'http://localhost:11434',
  model: 'qwen3.5:0.8b'
});
```

System prompt 的追加/替换与运行时修改见 [`sdk-integration-recipes.md`](./sdk-integration-recipes.md) 第 10 节。

## 3. 最小可用示例（建议从这里开始）

> **约定**：须通过 `Agent` 执行对话；`createOpenAI` 等仅用于构造 `Agent` 的 `model`，不要在应用里直接调用适配器的 `stream` / `complete`。详见 `sdk-overview.md` 第 3 节。

```ts
import { Agent, createOpenAI } from '@ddlqhd/agent-sdk';

const agent = new Agent({
  model: createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o'
  })
});

const result = await agent.run('用一句话介绍你自己');
console.log(result.content);

await agent.destroy();
```

## 4. 流式输出示例

```ts
import { Agent, createOpenAI } from '@ddlqhd/agent-sdk';

const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
});

for await (const event of agent.stream('解释一下什么是 MCP')) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.content);
  }
  if (event.type === 'tool_error') {
    console.error('\n[tool_error]', event.error.message);
  }
}

await agent.destroy();
```

## 5. 三种模型初始化方式

```ts
import {
  createModel,
  createOpenAI,
  createAnthropic,
  createOllama
} from '@ddlqhd/agent-sdk';

const openaiModel = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropicModel = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ollamaModel = createOllama({ baseUrl: process.env.OLLAMA_BASE_URL });

const model = createModel({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o'
});
```

## 6. 默认模型值

优先级见上文第 2 节。当前各提供商默认 `model`（基于源码）：

- OpenAI: `model = gpt-4o`
- Anthropic: `model = claude-sonnet-4-20250514`
- Ollama: `model = qwen3.5:0.8b`

## 7. 会话与上下文

`Agent` 默认会使用 JSONL 会话持久化。你可以通过 `sessionId` 复用上下文：

```ts
const first = await agent.run('我叫 Alice', { sessionId: 'user-123' });
const second = await agent.run('我叫什么？', { sessionId: 'user-123' });
```

## 8. 结束与资源释放

使用完毕后建议调用：

```ts
await agent.destroy();
```

这样可以确保 MCP 连接等资源被正确回收。

