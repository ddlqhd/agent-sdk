# 仓库目录结构（贡献者参考）

> **受众**：本仓库贡献者、或需要对照源码排查问题的开发者。若你仅通过 npm 使用 `@ddlqhd/agent-sdk`，请优先阅读 [`sdk-quickstart.md`](./sdk-quickstart.md) 与 [`sdk-integration-recipes.md`](./sdk-integration-recipes.md)。

```
agent-sdk/                          # private workspace root
├── packages/
│   ├── agent-sdk/                  # @ddlqhd/agent-sdk（库）
│   │   └── src/
│   │       ├── core/               # Agent 核心、类型、系统提示
│   │       │   ├── agent.ts
│   │       │   ├── types.ts
│   │       │   └── prompts.ts
│   │       ├── models/             # 模型适配器
│   │       ├── tools/              # 工具系统
│   │       │   ├── hooks/          # 工具 Hook（用户向说明见 docs/tool-hook-mechanism.md）
│   │       │   └── builtin/        # 内置工具
│   │       ├── storage/            # 会话存储
│   │       ├── streaming/          # 流式归一化与辅助
│   │       ├── mcp/                # MCP 客户端与适配器
│   │       ├── skills/             # Skill 加载与注册
│   │       ├── memory/             # CLAUDE.md 长期记忆
│   │       ├── config/             # MCP 等配置加载
│   │       └── index.ts            # 包入口
│   ├── agent-sdk-exec/             # @ddlqhd/agent-sdk-exec（Environment + exec-server）
│   ├── agent-sdk-cli/              # @ddlqhd/agent-sdk-cli（bin: agent-sdk）
│   │   ├── src/                    # CLI 入口与子命令、TUI、web UI
│   │   │   └── web/                # agent-sdk web（HTTP + WS + Vite 客户端）
│   │   └── bin/agent-sdk.mjs
│   └── agent-sdk-acp/              # @ddlqhd/agent-sdk-acp
├── tests/
├── examples/
├── package.json                    # 聚合脚本，不发布
├── pnpm-workspace.yaml
└── tsconfig.json
```

## Hook 实现位置（对照源码）

工具 Hook 的配置格式、事件类型与安全说明见 [`tool-hook-mechanism.md`](./tool-hook-mechanism.md)。源码入口：

- `packages/agent-sdk/src/tools/hooks/types.ts` — 类型与协议
- `packages/agent-sdk/src/tools/hooks/manager.ts` — `HookManager` 执行与合并
- `packages/agent-sdk/src/tools/hooks/loader.ts`（及同目录索引）— `settings.json` 加载与项目/用户配置发现

与 `ToolRegistry`、参数校验的衔接顺序见 `tool-hook-mechanism.md` 正文相关小节。
