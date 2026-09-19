# 执行面（exec-server）

Agent 循环、会话、模型请求仍在控制面（`Agent` / CLI / ACP）。工作区文件系统、子进程与从工作区出口的 HTTP 走 **Environment**：默认与 `Agent` 同进程；也可以把执行面放到另一台机器上的 `exec-server`。

应用代码继续只通过 `Agent` 集成。不要在业务里直接打 exec JSON-RPC。

## 默认行为

未配置 `AgentConfig.environment`、也未设置 `AGENT_SDK_EXEC_SERVER_URL` 时，内置 **Read / Write / Edit / Glob / Grep / Bash / WebFetch** 使用进程内 `LocalEnvironment`，语义与拆分前一致。

## 远程执行

在**工作区机器**上：

```bash
agent-sdk exec-server --listen 0.0.0.0:8787 --cwd /repo --token "$TOKEN"
```

独立二进制：

```bash
agent-sdk-exec --listen 127.0.0.1:8787 --cwd /repo --token "$TOKEN"
```

默认只听 `127.0.0.1`。跨机器时显式 `--listen 0.0.0.0:…`，并用 token。`--cwd` 作为 workspace root，越界路径会被拒绝。连接断开后，该连接上的托管进程会被终止。

stdout 会打连接、每条 RPC（method、耗时、路径 / 命令摘要，不含 token 和文件内容）和断开。控制面成功连上时写 `agent.initialize.environment`（远程为 `kind: remote` 且带 `url`）。

在**控制面机器**上：

```bash
agent-sdk chat --exec-server ws://workspace-host:8787 --exec-token "$TOKEN"
```

或：

```bash
export AGENT_SDK_EXEC_SERVER_URL=ws://workspace-host:8787
export AGENT_SDK_EXEC_SERVER_TOKEN=...
```

`chat` / `tui` / `web` / `-p` 与 ACP 都会读同一套 URL / token（ACP 通过环境变量）。

代码里：

```ts
const agent = new Agent({
  model,
  cwd: '/repo',
  environment: { type: 'remote', url: 'ws://127.0.0.1:8787', token }
});
```

也可传入已连接的 `Environment` 实例（子 Agent 会继承同一实例，避免重复建连）。

## 协议要点

WebSocket 上每帧一条 JSON-RPC 2.0。握手：`initialize` → `initialized`，之后才接受 `fs/*`、`process/*`、`http/request`。`sessionId` 在连接建立时生成，`initialize` 原样返回。路径为执行端绝对路径字符串。一期不做 PTY、不做断线会话恢复。

`chat` / `tui` / `web` / `-p` / ACP 在远程 environment 初始化失败时不会进入会话。

## 仍留在控制面

模型 HTTP、Session JSONL、工具审批 / Hook 决策、自定义 JS 工具、MCP 客户端、WebSearch（Tavily）、TodoWrite、AskUserQuestion。Hook / Skill 模板里的本地 `spawn` 一期仍走控制面进程。
