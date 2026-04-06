# Agent SDK 集成实战

## 1. 按环境切换模型提供商

```ts
import { Agent, createModel } from '@ddlqhd/agent-sdk';

const provider = (process.env.LLM_PROVIDER as 'openai' | 'anthropic' | 'ollama') || 'openai';

const model = createModel({
  provider,
  apiKey: provider === 'ollama' ? undefined : process.env.LLM_API_KEY,
  baseUrl: process.env.LLM_BASE_URL,
  model: process.env.LLM_MODEL
});

const agent = new Agent({ model });
```

建议：生产环境显式指定 `provider/model/baseUrl`，避免默认值漂移。

## 2. 自定义工具注册

```ts
import { Agent, createTool, createOpenAI } from '@ddlqhd/agent-sdk';
import { z } from 'zod';

const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
});

agent.registerTool(
  createTool({
    name: 'get_weather',
    description: '查询城市天气',
    parameters: z.object({
      city: z.string().describe('城市名')
    }),
    handler: async ({ city }) => ({
      content: `${city}: 晴，25C`
    })
  })
);
```

失败路径建议：

- 参数校验失败时返回 `isError: true`
- 工具内部异常转为可读错误信息，不要直接抛底层堆栈给模型

## 3. 替换内置工具（同名覆盖）

默认会先注册 SDK 内置工具；在 **`Agent` 构造配置的 `tools` 数组**里放入与内置**相同 `name`** 的 `ToolDefinition`，会用你的实现**替换**同名内置工具（无需先 `disallowedTools` 掉内置名——那样会导致内置与你的自定义都不会注册）。

```ts
import { Agent, createOpenAI, createTool } from '@ddlqhd/agent-sdk';
import { z } from 'zod';

const customRead = createTool({
  name: 'Read',
  description: 'Read a file (app-specific implementation)',
  parameters: z.object({
    file_path: z.string().describe('Path to the file')
  }),
  handler: async ({ file_path }) => ({
    content: `[stub] would read: ${file_path}`
  })
});

const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  tools: [customRead]
});
```

若需要**完全不使用**默认内置集合、只保留你列出的工具，使用 `exclusiveTools` 并提供完整列表（见 `AgentConfig` 说明）。

创建 Agent **之后**若要再换实现：`getToolRegistry().unregister('Read')` 再 `registerTool(...)`；`registerTool` 在名已存在时会抛错。

## 4. 安全模式内置工具

```ts
import { ToolRegistry, getSafeBuiltinTools, createSkillRegistry } from '@ddlqhd/agent-sdk';

const registry = new ToolRegistry();
const skillRegistry = createSkillRegistry();
registry.registerMany(getSafeBuiltinTools(skillRegistry));
```

`getSafeBuiltinTools` 会过滤 `isDangerous=true` 的工具（当前主要是 `Bash`）。

## 5. 会话持久化与恢复

```ts
import { Agent, createOpenAI } from '@ddlqhd/agent-sdk';

const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  storage: { type: 'jsonl' }
});

await agent.run('我叫 Bob', { sessionId: 's-001' });
const next = await agent.run('我叫什么？', { sessionId: 's-001' });
console.log(next.content);
```

失败路径建议：

- 传入不存在的 `sessionId` 时，SDK 会在恢复失败后自动创建新会话
- 若你需要严格控制，可在业务层先做 `sessionExists` 校验

## 6. MCP 配置文件加载（Claude Desktop 风格）

```ts
import { Agent, createOpenAI, loadMCPConfig } from '@ddlqhd/agent-sdk';

const { servers } = loadMCPConfig(undefined, process.cwd(), process.env.HOME);

const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  mcpServers: servers
});
```

最小 `mcp_config.json` 示例：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "remote-service": {
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_TOKEN}"
      }
    }
  }
}
```

## 7. Skill 自动加载与手动调用

- 默认扫描：
  - `{userBasePath}/.claude/skills`
  - `{cwd}/.claude/skills`
- 手动调用格式：`/skill-name [args]`

`SKILL.md` 示例（目录结构：`.claude/skills/MySkill/SKILL.md`）：

```md
---
name: code-review
description: Review code for risks and regressions
---

Analyze changed files and report critical issues first.
```

## 8. Memory 注入策略

SDK 从 **用户目录** 与 **工作区根目录** 两处加载长期记忆，合并后注入为额外 system message（包裹在 `<system-minder>` 标签内）。默认 **开启**（`memory !== false`）。

### 默认文件位置

- **用户级**：`{userBasePath}/.claude/CLAUDE.md`（`userBasePath` 默认为用户主目录，与 `AgentConfig.userBasePath` 一致）
- **工作区级**：`{workspaceRoot}/CLAUDE.md`（`workspaceRoot` 一般为 `AgentConfig.cwd`，即 `process.cwd()`）

可通过 `memoryConfig.workspacePath` **单独覆盖工作区记忆文件路径**（见 `MemoryConfig`）。

### 启用与禁用

```ts
import { Agent, createOpenAI } from '@ddlqhd/agent-sdk';

const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
});

const result = await agent.run('Help me with this code');
```

```ts
const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  memory: false
});
```

### 自定义工作区记忆路径

```ts
import { Agent, createOpenAI } from '@ddlqhd/agent-sdk';
import type { MemoryConfig } from '@ddlqhd/agent-sdk';

const memoryConfig: MemoryConfig = {
  workspacePath: '/custom/path/project-memory.md'
};

const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  memory: true,
  memoryConfig
});
```

### 记忆正文格式

注入前会将内容包在 `<system-minder>` 中（见 `MemoryManager` 实现）。

### 直接使用 MemoryManager

```ts
import { MemoryManager } from '@ddlqhd/agent-sdk';

const manager = new MemoryManager();
const memory = manager.loadMemory();

const manager2 = new MemoryManager('/workspace/root', { workspacePath: '/custom/project-memory.md' });
const { userHome, workspace } = manager2.checkMemoryFiles();
```

更完整的类型与字段见 [`sdk-types-reference.md`](./sdk-types-reference.md) 中 `MemoryConfig`。

## 9. 流式消费模板（生产可复用）

```ts
for await (const event of agent.stream(userInput, { includeRawStreamEvents: false })) {
  switch (event.type) {
    case 'text_delta':
      // 推送给前端 SSE/WebSocket
      break;
    case 'tool_call':
      // 记录调用审计
      break;
    case 'tool_error':
      // 告警
      break;
    case 'model_usage':
      // 流式 token 统计（可按需展示）
      break;
    case 'session_summary':
      // 权威 usage / iterations（成功完成前）；sessionId 见事件顶层注解字段
      break;
    case 'end':
      // 完成收尾
      break;
  }
}
```

## 10. System prompt 策略

SDK 内置默认系统提示（描述 Tools、Skills、Sessions 等能力）。可通过 **`AgentConfig.systemPrompt`** 追加或替换，并在运行时修改。

### 使用默认

不传 `systemPrompt` 即使用内置默认提示。

### 追加（默认）

```ts
const agent = new Agent({
  model,
  systemPrompt: '你擅长中文回答，并且总是给出详细的代码示例'
});

const agent2 = new Agent({
  model,
  systemPrompt: {
    content: '你擅长中文回答',
    mode: 'append'
  }
});
```

### 完全替换

```ts
const agent = new Agent({
  model,
  systemPrompt: {
    content: '你是自定义助手...',
    mode: 'replace'
  }
});
```

### 运行时修改

```ts
const agent = new Agent({ model });

agent.setSystemPrompt({
  content: '新的系统提示',
  mode: 'replace'
});
agent.appendSystemPrompt('额外的指令');
const current = agent.getSystemPrompt();
```

默认内置提示大致涵盖：工具使用说明、Skills、Sessions、任务原则、输出格式与安全提示等（以实际 `DEFAULT_SYSTEM_PROMPT` 为准）。

## 11. `AskUserQuestion` 与工具审批

### `AskUserQuestion`

内置工具 **`AskUserQuestion`** 需要宿主提供 **`AgentConfig.askUserQuestion`**，才能在 UI/CLI 中真正收集用户选择；未配置时工具会返回题面等静态信息，**不会阻塞**等待真实用户输入。

```ts
import { Agent, createOpenAI } from '@ddlqhd/agent-sdk';

const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  askUserQuestion: async (questions) =>
    questions.map((q, i) => ({
      questionIndex: i,
      selectedLabels: [q.options[0].label]
    }))
});
```

交互类工具与 `getAllBuiltinTools` 的配合见 [`sdk-api-reference.md`](./sdk-api-reference.md) 内置工具一节。

### `allowedTools` / `canUseTool`

用于**工具执行前审批**（与注册名一致）：

- 未设置 **`allowedTools`**：兼容行为——除 `disallowedTools` 外的工具均可自动执行（仍不暴露给模型的名不会注册）。
- 设置 **`allowedTools`**：列表内为**自动批准**；不在列表内的调用需 **`canUseTool(toolName, input)`** 返回 `true` 才执行；若配置了 `allowedTools` 且某次调用不在列表内、又未配置 `canUseTool`，则拒绝。
- **`allowedTools: []`**：无自动批准，每次执行都必须经 `canUseTool`；未配置 `canUseTool` 则全部拒绝。

完整语义与类型见 [`sdk-api-reference.md`](./sdk-api-reference.md) 中 `AgentConfig` 与 [`sdk-types-reference.md`](./sdk-types-reference.md)。

## 12. Subagent

启用内置 **`Agent`** 工具时，子代理在**隔离上下文**中运行。可通过 **`AgentConfig.subagent`** 配置：

- **`enabled`**：是否暴露 `Agent` 工具（默认 `true`）
- **`maxDepth`**：嵌套深度上限（默认 `1`，子代理内默认不再暴露 `Agent` 以防嵌套）
- **`maxParallel`**、**`timeoutMs`**、**`allowDangerousTools`**、**`defaultAllowedTools`**：并发、超时与子代理侧工具策略

详见 [`sdk-api-reference.md`](./sdk-api-reference.md) 与示例 **`examples/subagent-demo.ts`**（[`sdk-examples-index.md`](./sdk-examples-index.md)）。

## 13. 与 Web Demo 的对照

仓库 **`examples/web-demo`** 演示如何将环境变量、MCP 配置、Skill 目录与 Agent 构造串起来；生产环境可复用同一模式（配置对象 + `userBasePath` / `cwd`）。索引与文件清单见 [`sdk-examples-index.md`](./sdk-examples-index.md) 第 1 节。

