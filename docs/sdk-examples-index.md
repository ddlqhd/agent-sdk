# Agent SDK 示例索引

## 受众说明

- **仅通过 npm 使用 SDK 开发应用**：优先跟 [`sdk-quickstart.md`](./sdk-quickstart.md)、[`sdk-integration-recipes.md`](./sdk-integration-recipes.md) 与 **`agent-sdk web`**（见下节）对照，把「环境变量 → Agent 配置」的路径跑通即可。
- **本仓库贡献者或需要对照源码排障**：再使用下文 **第 2 节（Contributor）** 中的 `src/**` 与测试路径。

本页把文档中的能力点映射到仓库内可运行示例或实现文件，便于对照。

## 1. Web UI（推荐起点）

官方入口是 CLI 子命令 **`agent-sdk web`**（实现位于 `packages/agent-sdk-cli/src/web/`）。

## 1b. ACP Bridge（Zed / VS Code / JetBrains）

包目录：`packages/agent-sdk-acp/`（`agent-sdk-acp` CLI + `agent.json`）。通过 **stdio JSON-RPC** 将 `Agent.stream()` 暴露为 [Agent Client Protocol](https://agentclientprotocol.com/) 服务。

**与生产集成的对照方式**：`packages/agent-sdk-acp/src/agent-factory.ts` 演示如何从环境变量组装 `Agent`（含 MCP、Skill、Memory、`userBasePath`）；`packages/agent-sdk-cli/src/web/agent-factory.ts` 提供 Web UI 对照。未设置 `AGENT_SDK_ACP_USER_BASE` 时，会话默认写入稳定的 `tmpdir()/agent-sdk-acp`（非随机临时目录）。

文件清单：

- `packages/agent-sdk-acp/src/entry.ts`
- `packages/agent-sdk-acp/src/server.ts`
- `packages/agent-sdk-acp/src/session-manager.ts`
- `packages/agent-sdk-acp/src/agent-factory.ts`
- `packages/agent-sdk-acp/src/event-bridge.ts`
- `packages/agent-sdk-acp/src/permissions.ts`
- `packages/agent-sdk-acp/src/mcp-map.ts`
- `packages/agent-sdk-acp/agent.json`

Web UI 对照：

- `packages/agent-sdk-cli/src/commands/web.ts`
- `packages/agent-sdk-cli/src/web/start-server.ts`
- `packages/agent-sdk-cli/src/web/agent-factory.ts`
- `packages/agent-sdk-cli/src/web/env.ts`

CLI 调试入口见 [`sdk-cli.md`](./sdk-cli.md)。

## 2. 源码级参考（Contributor）

- Agent 生命周期：`packages/agent-sdk/src/core/agent.ts`
- Subagent 委派执行：`packages/agent-sdk/src/tools/builtin/subagent.ts`、`packages/agent-sdk/src/subagents/`
- 类型定义全集：`packages/agent-sdk/src/core/types.ts`
- 模型工厂与 provider 分发：`packages/agent-sdk/src/models/index.ts`
- OpenAI 适配：`packages/agent-sdk/src/models/openai.ts`
- Anthropic 适配：`packages/agent-sdk/src/models/anthropic.ts`
- Ollama 适配：`packages/agent-sdk/src/models/ollama.ts`
- 工具注册与执行：`packages/agent-sdk/src/tools/registry.ts`
- 内置工具聚合：`packages/agent-sdk/src/tools/builtin/index.ts`
- 同名覆盖内置工具（配置层）：[`sdk-integration-recipes.md`](./sdk-integration-recipes.md) 第 3 节、`packages/agent-sdk/src/core/agent.ts`（`registerInitialTools`）
- 会话管理：`packages/agent-sdk/src/storage/session.ts`
- MCP 配置加载：`packages/agent-sdk/src/config/mcp-config.ts`
- Memory 管理：`packages/agent-sdk/src/memory/manager.ts`
- Skill 注册与初始化：`packages/agent-sdk/src/skills/registry.ts`
- Skill 加载：`packages/agent-sdk/src/skills/loader.ts`
- Streaming 处理：`packages/agent-sdk/src/streaming/chunk-processor.ts`

## 3. 测试用例参考

- 工具行为：`tests/unit/tools.test.ts`
- 存储行为：`tests/unit/storage.test.ts`
- Skills 行为：`tests/unit/skills.test.ts`
- 流式处理：`tests/unit/chunk-processor.test.ts`

这些测试通常包含更精确的输入/输出预期，适合作为二次集成时的回归基准。

## 4. 文档与实现不一致时的处理建议

当你发现**文档**与**当前行为**不一致时：

1. 先以 `packages/agent-sdk/package.json` `exports` 与 `packages/agent-sdk/src/index.ts` 为公开边界
2. 再以对应实现文件（`packages/agent-sdk/src/**`）确认最终行为
3. 将关键参数显式写入你的接入配置，避免依赖隐式默认值

若确认为文档错误，欢迎提 issue 或 PR。
