# Agent SDK 示例索引

本页用于把文档中的能力点映射到仓库内可运行示例或实现文件，便于第三方快速对照。

## 1. Web Demo（推荐起点）

- `examples/web-demo/package.json`
- `examples/web-demo/server/agent-factory.ts`
- `examples/web-demo/server/env.ts`
- `examples/web-demo/demo-fixtures/mcp.demo.json`
- `examples/web-demo/demo-fixtures/.claude/skills/DemoSkill/SKILL.md`

适合学习：

- 环境变量到 Agent 配置的组装
- MCP 配置加载与降级处理
- Skill 与 Memory 的真实目录组织方式

## 2. 源码级参考（按能力）

- Agent 生命周期：`src/core/agent.ts`
- 类型定义全集：`src/core/types.ts`
- 模型工厂与 provider 分发：`src/models/index.ts`
- OpenAI 适配：`src/models/openai.ts`
- Anthropic 适配：`src/models/anthropic.ts`
- Ollama 适配：`src/models/ollama.ts`
- 工具注册与执行：`src/tools/registry.ts`
- 内置工具聚合：`src/tools/builtin/index.ts`
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

## 4. 文档与源码差异时的处理建议

当你发现 README、历史文档和当前行为不一致时：

1. 先以 `package.json` `exports` 与 `src/index.ts` 为公开边界
2. 再以对应实现文件（`src/**`）确认最终行为
3. 将关键参数显式写入你的接入配置，避免依赖隐式默认值

