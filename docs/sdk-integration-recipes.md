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

**规则与与 `disallowedTools` / `exclusiveTools` 的关系**以 [`sdk-api-reference.md`](./sdk-api-reference.md) 中「`AgentConfig` 工具与权限相关字段」与「**替换内置工具**」为准；以下为最小示例。

默认会先注册 SDK 内置工具；在 **`Agent` 构造配置的 `tools` 数组**里放入与内置**相同 `name`** 的 `ToolDefinition`，会用你的实现**替换**同名内置工具。

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

**与模型 HTTP 请求**：`Agent` 在每轮调用模型时会把**当前**会话 id 放进 `ModelParams.sessionId`。Anthropic 适配器会将其与 **`createAnthropic({ metadata })` 中配置的元数据**（对象或函数）合并后写入 Messages API 顶层 `metadata`（默认 `sessionId` → `user_id`）。详见 [`sdk-types-reference.md`](./sdk-types-reference.md) 中的 `ModelParams` 与 `AnthropicRequestMetadata`。

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

`mcpServers` 中每个 **key**（如上文的 `filesystem`、`remote-service`）即对应 `MCPServerConfig.name`（`serverName`）。Agent 侧该服务器暴露的工具注册名为 **`mcp__<serverName>__<工具名>`**（工具名为 MCP 服务返回的原始名）。配置 `disallowedTools`、系统提示或 Hook matcher 时需使用上述注册名；在 key 与代码中服务器名一致时，可用 `formatMcpToolName('filesystem', 'read_file')` 等形式生成，避免手写拼错。

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

## 10. SDK 日志接入

推荐通过 **`AgentConfig.logger`** 接入宿主应用自己的日志系统，而不是在应用代码里直接调用底层适配器。

```ts
import { Agent, createOpenAI, formatSDKLog } from '@ddlqhd/agent-sdk';
import pino from 'pino';

const appLogger = pino();

const agent = new Agent({
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  logLevel: 'info',
  logger: {
    info(event) {
      appLogger.info(event, formatSDKLog(event));
    },
    warn(event) {
      appLogger.warn(event, formatSDKLog(event));
    },
    error(event) {
      appLogger.error(event, formatSDKLog(event));
    },
    debug(event) {
      appLogger.debug(event, formatSDKLog(event));
    }
  }
});
```

关键约定：

- 每条日志都带固定 `source: 'agent-sdk'`，便于在宿主日志平台过滤。
- 文本前缀统一为 **`[agent-sdk][component][event]`**，便于控制台或文件直读。
- 默认只记录元信息；不会默认输出 prompt/body 全文。
- **未传入自定义 `logger`**、且当前有效日志级别**不是** `silent` 时，SDK 会使用内置实现把日志写到 **`console`**（`debug`→`console.debug`，`info`/`warn`/`error` 同理），并在有 `metadata` 时作为第二参数输出。若希望完全不在控制台出现 SDK 日志，请设置 `logLevel: 'silent'`（或环境变量 `AGENT_SDK_LOG_LEVEL=silent`），或始终传入自己的 `logger` 将输出只交给宿主系统。

常用配置：

```ts
const agent = new Agent({
  model,
  logger,
  logLevel: 'debug',
  redaction: {
    includeBodies: false,
    includeToolArguments: false,
    maxBodyChars: 2000
  }
});
```

### SDK 日志相关环境变量（详细说明）

下列变量在进程启动时读取，用于在未在代码里显式传入 `AgentConfig.logLevel` / `redaction` 时提供默认值。**代码中的配置始终优先**：若已设置 `logLevel` 或 `redaction` 的对应字段，则不会用环境变量覆盖该字段。

| 变量 | 作用 |
|------|------|
| `AGENT_SDK_LOG_LEVEL` | 控制 SDK 内部日志的**最低输出级别**。未设置且未传入 `logger` 时，默认不输出（等价于 `silent`）；若传入了 `logger` 但未设置本变量且代码里也未写 `logLevel`，则默认按 `info` 级别输出。设为 `debug`/`info`/… 且**仍未**传入 `logger` 时，日志会走内置 **`console`** 输出（见上条「关键约定」）。 |
| `AGENT_SDK_LOG_BODIES` | 为 `true` 时，在模型请求的日志元数据里允许包含**经脱敏处理后的请求体摘要**（如 `messages` 等）；为 `false` 或未设置时，不在日志里附带完整请求体结构。 |
| `AGENT_SDK_LOG_INCLUDE_TOOL_ARGS` | 为 `true` 时，在脱敏后的结构化数据里允许包含**工具调用的参数**；否则相关字段会显示为占位符（如 `REDACTED_TOOL_ARGUMENTS`）。 |
| `AGENT_SDK_LOG_MAX_BODY_CHARS` | 非负整数，限制单条字符串字段在日志中保留的最大字符数；超出部分截断并标注。未设置时默认 **4000**。 |

**`AGENT_SDK_LOG_LEVEL` 取值**（大小写不敏感，首尾空格会被忽略）：

- `debug`：输出调试级事件（如每轮 `agent.iteration.start`）。
- `info`：输出信息与更高级别。
- `warn`：仅警告与错误。
- `error`：仅错误。
- `silent`：不输出任何 SDK 日志（不传 `logger` 时不写 `console`；传入自定义 `logger` 时仍按级别过滤，通常也为无输出）。

**布尔类变量**（`AGENT_SDK_LOG_BODIES`、`AGENT_SDK_LOG_INCLUDE_TOOL_ARGS`）：

- 视为 **true**：`1`、`true`、`yes`（不区分大小写）。
- 视为 **false**：`0`、`false`、`no`（不区分大小写）。
- 其他非空字符串：不生效，回退到默认（通常为 false）。

**安全提示**：开启 `AGENT_SDK_LOG_BODIES` 或 `AGENT_SDK_LOG_INCLUDE_TOOL_ARGS` 可能使日志中出现对话或工具参数片段；生产环境请结合脱敏策略与日志留存策略使用。

默认会覆盖这些高价值节点：

- `agent.run.start` / `agent.run.end`
- `model.request.start` / `model.request.end` / `model.request.error`
- `tool.call.start` / `tool.call.end` / `tool.call.error`
- `context.compress.start` / `context.compress.end`

**Anthropic 与 HTTP 重试**：使用 `createAnthropic` 且未关闭 `fetchRetry` 时，`model.request.start` 的 `metadata` 含 `httpMaxAttempts`；成功或最终失败的 `model.request.end` / `model.request.error` 还含 **`httpAttempt`**（本次结果来自第几次 HTTP 尝试，从 1 起）与 **`httpMaxAttempts`**，便于区分重试前后的日志。

## 11. System prompt 策略

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

## 12. `AskUserQuestion` 与工具审批

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

用于**工具执行前审批**（与注册名一致）。**完整语义**以 [`sdk-api-reference.md`](./sdk-api-reference.md)「`AgentConfig` 工具与权限相关字段」为准；摘要：

- 未设置 **`allowedTools`**：除 `disallowedTools` 外默认可执行。
- 设置 **`allowedTools`**：列表内自动批准；未命中时需 **`canUseTool`**，否则拒绝。
- **`allowedTools: []`**：无自动批准，依赖 **`canUseTool`**（未配置则全部拒绝）。

## 13. Subagent

内置工具 **`Agent`** 将任务委托给**新的 `Agent` 实例**在隔离上下文中执行（不继承父会话消息）。父级配置中的 **`AgentConfig.subagent`** 控制是否暴露该工具、嵌套深度、并发与超时等，字段说明见 [`sdk-api-reference.md`](./sdk-api-reference.md)。

### 工具调用参数（`SubagentRequest`）

根包通过 `export *` 导出 `SubagentRequest` 与 `subagentRequestSchema`，与运行时校验一致，主要包括：

| 字段 | 说明 |
|------|------|
| **`prompt`** | 子任务描述（必填） |
| **`description`** | 短标签，用于日志与返回 **metadata** |
| **`subagent_type`** | `'general-purpose'` \| `'explore'`（默认 `general-purpose`）。**当前实现中仅写入结果 metadata**（`subagentType`），**不**据此切换专用工具集或追加系统提示；与描述文案中的 “profile” 相关的差异化行为以未来版本为准。 |
| **`allowed_tools`** | 可选，按**注册名**白名单；若省略则使用 `AgentConfig.subagent.defaultAllowedTools`，若二者皆无则从**父级工具注册表**中选取 |
| **`max_iterations`** | 子运行轮次上限；默认继承父 `AgentConfig.maxIterations`，并与 `DEFAULT_MAX_ITERATIONS` 链式合并 |
| **`timeout_ms`** | 单次委托超时；实际上限为 `min(请求值, subagent.timeoutMs)` |
| **`system_prompt`** | 作为子 `run` 的 `systemPrompt` 选项传入（与主会话系统提示独立） |

### 子 Agent 实际可用的工具

解析规则（与源码 `resolveSubagentTools` 一致）：

1. 候选名来自 **`allowed_tools`**，或 **`defaultAllowedTools`**，或「父级全部**非** `isDangerous` 的工具」。
2. 始终移除 **`Agent`**、**`AskUserQuestion`**（子级不可再委托、避免交互阻塞）。
3. 若 **`allowDangerousTools`** 为 `false`：从候选集中去掉危险工具；若 **`allowed_tools`** 显式包含危险工具则直接报错。
4. 子 `Agent` 使用 **`exclusiveTools`** 指向上述解析结果，**不**再合并 `AgentConfig.tools`；**不**继承父级 **MCP**（`mcpServers` 清空）。
5. 子级 **`subagent.enabled`** 置为 **`false`**，故子会话内**不会**注册 `Agent` 工具（嵌套深度由 `maxDepth` 与 `ToolExecutionContext.agentDepth` 共同约束）。

### 返回与 metadata

成功时工具结果可带 **`metadata`**（如 `sessionId`、`subagentType`、`durationMs`、`usage`、`toolNames`、`description`），便于观测与计费；失败路径亦可能含部分字段。

示例见 **`examples/subagent-demo.ts`**（[`sdk-examples-index.md`](./sdk-examples-index.md)）。

## 14. 与 Web Demo 的对照

仓库 **`examples/web-demo`** 演示如何将环境变量、MCP 配置、Skill 目录与 Agent 构造串起来；生产环境可复用同一模式（配置对象 + `userBasePath` / `cwd`）。索引与文件清单见 [`sdk-examples-index.md`](./sdk-examples-index.md) 第 1 节。

