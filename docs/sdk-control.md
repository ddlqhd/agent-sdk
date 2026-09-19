# 控制面 kernel（第一方宿主）

`@ddlqhd/agent-sdk-control` 是 CLI / Web / ACP 共用的**内部控制面**。它负责 Agent 组装、会话表、`runTurn` 和远程执行面解析。

**第三方应用不要依赖这个包。** 产品代码继续只通过 [`Agent`](./sdk-overview.md) 集成。架构决策见 [`adr/0001-control-kernel.md`](./adr/0001-control-kernel.md)。

## 分层

```
CLI / TUI（in-process） ─┐
Web 私有 WS ────────────┼─→ SessionRuntime + buildControlAgent + runTurn ─→ Agent ─→ Environment
ACP stdio ──────────────┘
```

- **kernel 保证**：create / load / list / fork / close、`runTurn`、provider/env、`AGENT_SDK_EXEC_SERVER_*`
- **adapter 故意不同**：ACP 审批与 edit mode、Web rewind / settings persist、CLI allowlist 与 TTY AskUserQuestion
- **执行面**：仍是 [`sdk-exec-server.md`](./sdk-exec-server.md)，不是控制面

## 暂缓公开 app-server 协议

目前**不**发布 Codex 式 `thread/start` + `turn/start` JSON-RPC，也不把 Web/CLI 收进 ACP 进程。

再评估公开协议的条件（同时满足才值得）：

1. 多个第一方 UI 要连同一个长驻 Agent 进程
2. 需要远程控制面（笔记本 UI 连工作区机器上的 agent loop）
3. 第一方客户端多到改私有协议比适配器翻译更贵

在此之前，传输保持：ACP stdio、Web loopback WS、CLI/TUI in-process。
