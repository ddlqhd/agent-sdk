# ADR 0001：控制面 kernel（非 Codex 式公开 app-server）

**状态**：已采纳  
**日期**：2026-09-19

## 决策

ACP、CLI、Web **共用内部 control kernel**（`@ddlqhd/agent-sdk-control`），**不**合并为一条对外 JSON-RPC，也 **不**把三者收进同一个进程。

- 第三方集成面仍是 [`Agent`](../sdk-overview.md)，不经过 control 包。
- 执行面仍是 Environment / [`exec-server`](../sdk-exec-server.md)。
- 线协议保持分叉：ACP stdio、Web 私有 WS、TTY。
- **暂缓**发布 Codex 体量的 `thread/start` + `turn/start` 稳定协议。

## 背景

三条表面都调用同一个 `Agent`，但会话表、工厂、权限、事件桥、配置源各写一遍，语义已经分叉。Codex 抽出 app-server 是为了让 VS Code / Desktop / Web / TUI 共用同一套 Thread 编排；他们并没有用一条协议替换 IDE 标准。对本仓库，IDE 线已经是 ACP。

## 能力矩阵

每项标为：

- **kernel**：所有宿主必须一致（由 `@ddlqhd/agent-sdk-control` 保证）
- **adapter**：协议或产品故意不同，只通过 port 注入
- **optional**：kernel 提供 API，适配器可选用

### 会话

| 能力 | kernel | CLI / TUI | Web | ACP |
|------|--------|-----------|-----|-----|
| create | kernel | 单 Agent 上 `createSession` / `/new` | `sessions:new` / `configure` | `session/new` |
| load / resume | kernel | `--session` / `--resume` | `sessions:resume` | `session/load` |
| list | kernel | `sessions list`、slash | `sessions:list`（标题由 adapter 补） | `session/list`（分页 + cwd 过滤） |
| fork | kernel | `--fork*`、slash | `sessions:fork`（含 checkpoint） | `session/fork`（active chain） |
| close / destroy | kernel | 进程退出 `destroy` | 断线 / reconfigure | `session/close`（不删 JSONL） |
| rewind | optional | slash / `sessions rewind` | `sessions:rewind` | **无**（协议无 rewind，故意） |
| delete stored session | optional | `sessions` CLI | `sessions:delete` | 不暴露 |

### Turn

| 能力 | kernel | CLI / TUI | Web | ACP |
|------|--------|-----------|-----|-----|
| prompt / stream | kernel `runTurn` | in-process client | `chat` / `chat_run` | `session/prompt` |
| cancel | kernel（AbortSignal） | ESC | `cancel`（按 requestId） | `session/cancel`（按 session） |
| 非流式 `run` | optional | `--no-stream` / `-p` json | 不用（UI 仍 stream） | 不用 |
| 结束原因 | kernel 原样返回 | 终端展示 | `chat_done` | 映射 ACP `StopReason` |

### 权限与交互

| 能力 | 归属 | CLI / TUI | Web | ACP |
|------|------|-----------|-----|-----|
| `canUseTool` | adapter port | 无（静态 `allowedTools`） | 无 | `session/request_permission` |
| allowlist / denylist | kernel 透传 `AgentConfig` | `--allowed-tools`、`--bare` | `safeToolsOnly` 砍 Bash + dangerous | `allowedTools` + 禁 `AskUserQuestion` |
| edit mode | adapter | 无 | 无 | `default` / `accept_edits` / `dont_ask` |
| AskUserQuestion | adapter port | TTY resolver | WS 往返 | 禁用（`disallowedTools`） |

### 执行面与配置

| 能力 | 归属 | CLI / TUI | Web | ACP |
|------|------|-----------|-----|-----|
| remote environment | kernel 解析 | `--exec-server` / env | 启动 flag / env | **同一套** `AGENT_SDK_EXEC_SERVER_*` |
| provider / API key | kernel `env` | flags > settings > 默认 | `configure` + env | `AGENT_SDK_ACP_*` + 通用 key |
| user-base | kernel（fallback 可不同） | `~` 或 `--user-base-path` | 同上 | `AGENT_SDK_ACP_USER_BASE` 或 `tmpdir()/agent-sdk-acp` |
| settings persist | adapter | 只读 `agent-sdk-settings.json` | UI `persist` 写入 | 无 |
| MCP 来源 | kernel 透传 | flags / settings / 发现 | 路径 + 文件 | 请求体 `mcpServers` + 工作区文件 |
| 事件形状 | adapter sink | 终端 formatter | `serializeStreamEvent` | `session/update` |

## 包边界

- 新包 `@ddlqhd/agent-sdk-control`：工厂、env、user-base、remote environment、`SessionRuntime`、`runTurn`、ports。
- `@ddlqhd/agent-sdk-acp` 与 `@ddlqhd/agent-sdk-cli` 依赖 control；**ACP 不依赖 CLI**。
- 不把 kernel 放进 `@ddlqhd/agent-sdk` 公开导出。

## 何时才加公开 app-server 协议

同时出现以下需求再评估 stdio / unix-socket JSON-RPC（WS 保持实验）：

1. 多个第一方 UI 要连**同一个**长驻 Agent 进程。
2. 需要远程控制面（笔记本 UI 连工作区机器上的 agent loop）。
3. 第一方客户端多到「改私有协议」比「适配器翻译」更贵。

在此之前，Web 仍是 loopback Studio，ACP 仍是编辑器桥，CLI/TUI 仍是 **in-process** kernel client。
