# Agent SDK 示例索引

## 受众说明

- **仅通过 npm 使用 SDK 开发应用**：优先跟 [`sdk-quickstart.md`](./sdk-quickstart.md)、[`sdk-integration-recipes.md`](./sdk-integration-recipes.md) 与 **Web Demo**（见下节）对照，把「环境变量 → Agent 配置」的路径跑通即可。
- **本仓库贡献者或需要对照源码排障**：再使用下文 **第 2 节（Contributor）** 中的 `src/**` 与测试路径。

本页把文档中的能力点映射到仓库内可运行示例或实现文件，便于对照。

## 1. Web Demo（推荐起点）

示例目录：`examples/web-demo/`。

**与生产集成的对照方式**：`examples/web-demo/server/env.ts` 演示如何从环境变量组装模型与路径；`agent-factory.ts` 演示如何创建 `Agent`（含 MCP、Skill、Memory 路径等）；`demo-fixtures/mcp.demo.json` 与 `demo-fixtures/.claude/skills/` 演示配置文件与 Skill 目录的**真实布局**。将你在 Demo 里验证过的选项迁移到自有服务时，保持同一 `AgentConfig` 字段语义即可（详见 [`sdk-integration-recipes.md`](./sdk-integration-recipes.md) 第 14 节「与 Web Demo 的对照」）。

文件清单：

- `examples/web-demo/package.json`
- `examples/web-demo/server/agent-factory.ts`
- `examples/web-demo/server/env.ts`
- `examples/web-demo/demo-fixtures/mcp.demo.json`
- `examples/web-demo/demo-fixtures/.claude/skills/DemoSkill/SKILL.md`

CLI 调试入口见 [`sdk-cli.md`](./sdk-cli.md)。

## 2. 源码级参考（Contributor）

- Agent 生命周期：`src/core/agent.ts`
- Subagent 委派执行：`examples/subagent-demo.ts`
- 类型定义全集：`src/core/types.ts`
- 模型工厂与 provider 分发：`src/models/index.ts`
- OpenAI 适配：`src/models/openai.ts`
- Anthropic 适配：`src/models/anthropic.ts`
- Ollama 适配：`src/models/ollama.ts`
- 工具注册与执行：`src/tools/registry.ts`
- 内置工具聚合：`src/tools/builtin/index.ts`
- 同名覆盖内置工具（配置层）：[`sdk-integration-recipes.md`](./sdk-integration-recipes.md) 第 3 节、`src/core/agent.ts`（`registerInitialTools`）
- 会话管理：`src/storage/session.ts`
- MCP 配置加载：`src/config/mcp-config.ts`
- Memory 管理：`src/memory/manager.ts`
- Skill 注册与初始化：`src/skills/registry.ts`
- Skill 加载：`src/skills/loader.ts`
- Streaming 处理：`src/streaming/chunk-processor.ts`

## 3. 测试用例参考

- 工具行为：`tests/unit/tools.test.ts`
- 存储行为：`tests/unit/storage.test.ts`
- Skills 行为：`tests/unit/skills.test.ts`
- 流式处理：`tests/unit/chunk-processor.test.ts`

这些测试通常包含更精确的输入/输出预期，适合作为二次集成时的回归基准。

## 4. 文档与实现不一致时的处理建议

当你发现**文档**与**当前行为**不一致时：

1. 先以 `package.json` `exports` 与 `src/index.ts` 为公开边界
2. 再以对应实现文件（`src/**`）确认最终行为
3. 将关键参数显式写入你的接入配置，避免依赖隐式默认值

若确认为文档错误，欢迎提 issue 或 PR。
