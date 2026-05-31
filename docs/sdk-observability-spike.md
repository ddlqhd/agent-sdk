# Observability spike: `diagnostics_channel`

## Status

Experimental second outlet alongside structured `LogEvent` logs. No subscriber → **zero overhead** (`hasSubscribers` guard).

## Channels

| Channel name | Constant | Intended payloads |
|--------------|----------|-------------------|
| `agent-sdk:run` | `SDK_DIAGNOSTIC_CHANNELS.run` | Run lifecycle (`agent.run.*`) |
| `agent-sdk:model.request` | `SDK_DIAGNOSTIC_CHANNELS.modelRequest` | HTTP request lifecycle |

## API

```ts
import { publishSdkDiagnostic, SDK_DIAGNOSTIC_CHANNELS } from '@ddlqhd/agent-sdk';
import diagnosticsChannel from 'node:diagnostics_channel';

diagnosticsChannel.channel(SDK_DIAGNOSTIC_CHANNELS.run).subscribe((payload) => {
  console.log('run diagnostic', payload);
});

publishSdkDiagnostic('run', 'agent.run.start', { runId: '...' });
```

`publishSdkDiagnostic` is exported from the package but **does not** forward `sdkLog` / `LogEvent` traffic automatically. Subscribing to a channel alone will not receive agent run or model HTTP events unless your application (or a future opt-in flag) calls `publishSdkDiagnostic`. Use `AgentConfig.logger` for structured logs; use diagnostics channels when you want a separate, APM-oriented stream.

## Future work

- Optional auto-publish from `sdkLog` for selected events (behind `AgentConfig.diagnostics?: boolean`).
- `TracingChannel` wrappers for async run/model spans (Node 18+).
- OpenTelemetry bridge package (out of core SDK scope).

## References

- [Node.js diagnostics_channel](https://nodejs.org/api/diagnostics_channel.html)
- [openai-node #1819](https://github.com/openai/openai-node/issues/1819) — TracingChannel discussion
