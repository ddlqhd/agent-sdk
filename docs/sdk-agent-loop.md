# Agent 执行循环（用户向）

第三方应用应通过 **`Agent.run`** / **`Agent.stream`** 驱动对话（见 [`sdk-overview.md`](./sdk-overview.md) 第 3 节）。本页说明「循环」在**行为与可观测性**上的含义，不涉及内部类实现细节。

## 循环里发生什么

在单次 `run` / `stream` 调用内，SDK 会在 **最大迭代次数**（`AgentConfig.maxIterations`）范围内重复。构造 `Agent` 时若未传入 `maxIterations`，默认合并为 **400**（`DEFAULT_MAX_ITERATIONS`，与 `src/core/agent.ts` 一致）：

1. 将当前消息历史交给模型，得到助手输出（可能包含工具调用）。
2. 若有工具调用，则执行工具，将结果写回消息历史，再进入下一轮。
3. 若无进一步工具调用或达到终止条件，则结束本轮用户请求。

这就是「模型 → 工具 → 再模型」的 **Agent 循环**。

## 流式事件中的 `iteration`

在 **`Agent.stream`** 发出的事件上，可能带有 `StreamEventAnnotations`（见 [`sdk-types-reference.md`](./sdk-types-reference.md) 第 5 节）：

- **`iteration`**：从 **0** 开始的整数，表示当前处于第几轮「模型参与」的迭代（多轮工具循环时递增）。
- **`sessionId`**：当前会话 id，用于关联持久化与审计。

每一轮调用底层 `ModelAdapter` 时，SDK 还会在 **`ModelParams.sessionId`** 中传入同一会话 id（见 [`sdk-types-reference.md`](./sdk-types-reference.md) `ModelParams`）。具体是否在 HTTP 请求里使用由适配器决定（例如 Anthropic 会将其并入 Messages API 的 `metadata`）。

集成 UI 或日志时，可用 `iteration` 区分同一轮用户输入下的多轮模型/工具往返。

## 与 `maxIterations` 的关系

若对话需要过多轮工具才能完成，可能触及 `maxIterations`。此时会在 **`session_summary` 之后**收到 `end`，且 **`reason: 'max_iterations'`**（用量仍以 `session_summary.usage` 为准）。生产环境可结合 [`sdk-troubleshooting.md`](./sdk-troubleshooting.md)「工具调用循环过多」一节调参。

## 取消与 `StreamOptions.signal`

`Agent.stream` 的 **`signal`** 与向模型传参的 **`ModelParams.signal` 为同一** `AbortSignal`：在「等待下一轮模型输出」的流上取消会尽快结束。工具阶段也会收到同一 signal：`ToolRegistry.execute` 的选项与 `ToolExecutionContext` 上均有 **`signal`**；若本批工具在尚未开始执行时 signal 已处于 aborted，本轮工具不会真实执行，而是得到统一的「**The operation was aborted.**」式结果。已在运行中的**自定义**长任务应在 handler 中检查 `context.signal?.aborted`、把 `signal` 转交给 `fetch` / 子进程 / 可取消的宿主机 IO。内置 **`AskUserQuestion`** 在配置了 `askUserQuestion` 时，会将 **`{ signal }`** 传给 resolver，CLI 与 web-demo 会在 abort 时结束等待、避免读 stdin/弹窗无限阻塞。通过 **`Agent` 工具** 启动的子代理会把**同一** `signal` 传给子 `Agent.run` / `stream`，父级取消时子级也会按上述规则结束。无法协作取消的代码仍可能在后台跑完，这是**协作式取消**的固有限制。

## 另见

- 会话持久化与 `sessionId`：[`sdk-quickstart.md`](./sdk-quickstart.md)、[`sdk-integration-recipes.md`](./sdk-integration-recipes.md) 会话章节。
- 流式事件类型全集：[`sdk-types-reference.md`](./sdk-types-reference.md) 第 5 节。
