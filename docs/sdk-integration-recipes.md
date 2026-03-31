# Agent SDK 集成实战

## 1. 按环境切换模型提供商

```ts
import { Agent, createModel } from 'agent-sdk';

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
import { Agent, createTool, createOpenAI } from 'agent-sdk';
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

## 3. 安全模式内置工具

```ts
import { ToolRegistry, getSafeBuiltinTools, createSkillRegistry } from 'agent-sdk';

const registry = new ToolRegistry();
const skillRegistry = createSkillRegistry();
registry.registerMany(getSafeBuiltinTools(skillRegistry));
```

`getSafeBuiltinTools` 会过滤 `isDangerous=true` 的工具（当前主要是 `Bash`）。

## 4. 会话持久化与恢复

```ts
import { Agent, createOpenAI } from 'agent-sdk';

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

## 5. MCP 配置文件加载（Claude Desktop 风格）

```ts
import { Agent, createOpenAI, loadMCPConfig } from 'agent-sdk';

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

## 6. Skill 自动加载与手动调用

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

## 7. Memory 注入策略

默认读取：

- `{userBasePath}/.claude/CLAUDE.md`
- `{workspaceRoot}/CLAUDE.md`

并注入为额外 system message（包裹在 `<system-minder>` 标签内）。

## 8. 流式消费模板（生产可复用）

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
    case 'metadata':
      // 记录 usage/sessionId
      break;
    case 'end':
      // 完成收尾
      break;
  }
}
```

