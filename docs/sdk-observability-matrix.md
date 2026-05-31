# SDK observability matrix

Agent SDK exposes two complementary surfaces:

1. **Structured logs** (`AgentConfig.logger`, `LogEvent`) — operations, audit, log platforms.
2. **`callbacks.lifecycle`** — UI, metrics, product hooks (does not change execution).

Do not duplicate both for the same fact unless you need different consumers.

## Lifecycle callback vs structured log

| Lifecycle callback | Structured `LogEvent`? | Notes |
|--------------------|------------------------|-------|
| `onRunStart` | Yes — `agent.run.start` | Agent logs automatically |
| `onRunEnd` | Yes — `agent.run.end` / `agent.run.error` / `agent.run.aborted` | |
| `onRunAbort` | Yes — `agent.run.aborted` | |
| `onIterationStart` | Yes — `agent.iteration.start` | |
| `onIterationEnd` | Yes — `agent.iteration.end` | |
| `onModelRequestStart` | Yes — `model.request.start` | Model adapter |
| `onModelRequestEnd` | Yes — `model.request.end` | Model adapter |
| `onModelRequestError` | Yes — `model.request.error` / `model.request.aborted` | |
| `onToolExecutionStart` | Yes — `tool.call.start` | |
| `onToolExecutionEnd` | Yes — `tool.call.end` / `tool.call.error` | |
| `onToolResult` | **No** | Use callback for full `ToolResult` |
| `onToolCallPlanned` | **No** | Planning only |
| `onAssistantMessage` | **No** | Streaming/UI |
| `onModelEvent` | **No** | Raw stream chunks |
| `onUserMessage` / `onSystemMessage` | **No** | Message content |
| `onMessagePersist` | Partial — `session.persist.*` | Persist outcome only |
| `onContextCompressed` | Partial — `context.compress.*` | Compression pipeline |
| `onSessionCreate` / `onSessionResume` | **No** | Session metadata |
| `onAgentError` | Partial — run/tool error logs | Plus `agent.callback.error` |

## Recommended patterns

| Goal | Approach |
|------|----------|
| Production audit trail | `logger` + `logLevel: 'warn'` or `'info'`, JSONL or pino via `adaptMessageLogger` |
| Chat UI / streaming | `callbacks.lifecycle` + `Agent.stream` events |
| Tool approval UI | `canUseTool` + `onToolCallPlanned` |
| Debug HTTP | `logLevel: 'debug'` + `redaction.includeBodies` (or env `AGENT_SDK_LOG_BODIES`) |
| APM / custom tracing | Subscribe to `publishSdkDiagnostic` channels (see [sdk-observability-spike.md](./sdk-observability-spike.md)) |

## Hooks vs logs

| Mechanism | Role |
|-----------|------|
| `HookManager` | Can block or modify tool input |
| `hook.*` log events | Diagnostics when hooks misbehave or deny tools |
| `lifecycle.hooks` observer | Typed observation of hook decisions (`hook.decision` log mirrors this) |

See [tool-hook-mechanism.md](./tool-hook-mechanism.md) and [sdk-log-events.md](./sdk-log-events.md).
