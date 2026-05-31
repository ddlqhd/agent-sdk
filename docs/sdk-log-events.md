# SDK structured log events

All structured logs use `source: 'agent-sdk'`, a `component`, and an `event` string. See [sdk-integration-recipes.md](./sdk-integration-recipes.md) for configuration.

**Note:** Context compression logs use `component: 'memory'` with `event: 'context.compress.*'` (not a separate `compress` component).

## Agent (`component: agent`)

| event | Typical level | Description |
|-------|---------------|-------------|
| `agent.run.start` | info | `stream()` / `run()` started |
| `agent.run.end` | info | Run finished successfully |
| `agent.run.aborted` | info | Run aborted |
| `agent.run.error` | error | Run failed |
| `agent.iteration.start` | debug | Model iteration began |
| `agent.iteration.end` | debug | Model iteration ended |
| `agent.initialize.hooks.error` | error | Hook discovery failed |
| `agent.initialize.skills.error` | error | Skill init failed |
| `agent.initialize.subagent.error` | error | Subagent profile init failed |
| `agent.callback.error` | error | Lifecycle callback threw |
| `subagent.profile.load.error` | warn | Subagent profile file load failed |

## Tooling (`component: tooling`)

| event | Typical level | Description |
|-------|---------------|-------------|
| `tool.call.start` | info | Tool execution started |
| `tool.call.end` | info | Tool finished (success) |
| `tool.call.error` | warn / error | Tool returned error or threw |

## Model (`component: model`)

| event | Typical level | Description |
|-------|---------------|-------------|
| `model.request.start` | info | HTTP request started |
| `model.request.end` | info | HTTP response OK |
| `model.request.error` | warn / error | HTTP error or failure |
| `model.request.aborted` | info | Request aborted (`AbortError`) |

## Streaming (`component: streaming`)

| event | Typical level | Description |
|-------|---------------|-------------|
| `model.stream.parse_error` | warn | SSE/chunk parse failure |

## Session (`component: session`)

| event | Typical level | Description |
|-------|---------------|-------------|
| `session.persist.complete` | debug / info | Messages persisted |
| `session.persist.error` | warn | Persist failed |
| `session.sidecar.error` | warn | System prompt sidecar failed |

## MCP (`component: mcp`)

| event | Typical level | Description |
|-------|---------------|-------------|
| `mcp.config.env.missing` | warn | Undefined env var in config |
| `mcp.config.load.error` | error | Config parse/validation failed |
| `mcp.connect.start` | info | Connecting servers |
| `mcp.connect.end` | info | Connect finished |
| `mcp.connect.error` | error | Connect failed |
| `mcp.connect.duplicate_skipped` | warn | Duplicate server name skipped |
| `mcp.disconnect.end` | debug | Disconnect |
| `mcp.tool.name_invalid` | warn | Invalid MCP tool name |
| `mcp.tool.already_registered` | warn | Tool name collision |

## Hooks (`component: hooks`)

| event | Typical level | Description |
|-------|---------------|-------------|
| `hook.decision` | debug / info | Pre-tool hook allow/deny |
| `hook.command.exit_unexpected_pre` | error | Hook command exited before tool |
| `hook.command.non_zero_exit` | warn | Hook command non-zero exit |
| `hook.command.failed` | error | Hook command failed |
| `hook.async.command.non_zero_exit` | warn | Async hook non-zero exit |
| `hook.async.command.failed` | error | Async hook failed |
| `hook.function.failed` | error | Hook function threw |

## Skill (`component: skill`)

| event | Typical level | Description |
|-------|---------------|-------------|
| `skill.register.error` | warn | Register loaded skill failed |
| `skill.load.entry.error` | warn | Directory entry load failed |
| `skill.load.directory.done` | info | Directory scan loaded skills |
| `skill.load.directory.error` | warn | Directory scan failed |
| `skill.load.path.error` | warn | Configured path load failed |
| `skill.initialized.summary` | info | Registry init summary |

## Memory (`component: memory`)

| event | Typical level | Description |
|-------|---------------|-------------|
| `memory.file.read.error` | warn | CLAUDE.md read failed |
| `context.compress.start` | info | Compression started |
| `context.compress.skipped` | debug | Not enough messages to compress |
| `context.compress.end` | info | Compression completed |
| `context.compress.error` | error | Compression failed |

## Extending

Custom tools or host code should use `sdkLog` with a shared `SDKLogContext`:

```ts
import { sdkLog, type SDKLogContext } from '@ddlqhd/agent-sdk';

sdkLog(ctx, 'info', {
  component: 'tooling',
  event: 'my_extension.done',
  message: 'Optional human-readable line',
  metadata: { key: 'value' }
});
```
