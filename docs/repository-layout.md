# 仓库目录结构（贡献者参考）

> **受众**：本仓库贡献者、或需要对照源码排查问题的开发者。若你仅通过 npm 使用 `@ddlqhd/agent-sdk`，请优先阅读 [`sdk-quickstart.md`](./sdk-quickstart.md) 与 [`sdk-integration-recipes.md`](./sdk-integration-recipes.md)。

```
agent-sdk/
├── src/
│   ├── core/              # Agent 核心、类型、系统提示
│   │   ├── agent.ts       # Agent 类
│   │   ├── types.ts       # 类型定义
│   │   └── prompts.ts     # 默认系统提示模板
│   ├── models/            # 模型适配器
│   │   ├── base.ts
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   └── ollama.ts
│   ├── tools/             # 工具系统
│   │   ├── registry.ts
│   │   ├── hooks/         # 工具 Hook
│   │   └── builtin/       # 内置工具
│   ├── storage/           # 会话存储
│   ├── streaming/         # 流式归一化与辅助
│   ├── mcp/               # MCP 客户端与适配器
│   ├── skills/            # Skill 加载与注册
│   ├── memory/            # CLAUDE.md 长期记忆
│   ├── config/            # MCP 等配置加载
│   ├── cli/               # CLI 入口与子命令
│   └── index.ts           # 包入口
├── tests/
├── examples/
├── package.json
├── tsconfig.json
└── tsup.config.ts
```
