# Changelog

## Unreleased

### Added

- **Logging**: `SDKLogContext`, `createSDKLogContext`, `withLogScope`, and `sdkLog()` to propagate logger config and correlation fields (`sessionId`, `runId`, `agentName`, `cwd`) without repeating `emitSDKLog` arguments across modules.
- **Logging**: `adaptMessageLogger` / `adaptConsoleLogger` for pino/winston-style loggers; public exports for `emitSDKLog` (deprecated), `sdkLog`, and helpers.
- **Logging**: `ModelParams.logContext` preferred over separate `logger` / `logLevel` / `redaction` on model requests.
- **Docs**: [sdk-log-events.md](./docs/sdk-log-events.md), [sdk-observability-matrix.md](./docs/sdk-observability-matrix.md), [sdk-observability-spike.md](./docs/sdk-observability-spike.md).
- **Observability**: `publishSdkDiagnostic` and `SDK_DIAGNOSTIC_CHANNELS` (`node:diagnostics_channel`, opt-in).
- **Session fork & rewind**: `RewindEntry` in JSONL; `SessionManager.forkSession`, `rewindSession`, `rewindToCheckpoint`, `listSessionCheckpoints`; `Agent` mirrors with `forkSession`, `rewindToCheckpoint`, `listSessionCheckpoints`, `getActiveMessageCount`; `StreamOptions.forkSession` to fork before `stream`. Lifecycle: `onSessionFork`, `onSessionRewind`. See [`docs/sdk-api-reference.md`](./docs/sdk-api-reference.md) (Rewind 集成指南).

### Changed

- Internal modules (Agent, tools, skills, MCP config, compressor, model request log) now emit via `sdkLog` and shared context; `HookManagerSdkLogContext` is an alias of `SDKLogContext`.
- `loadMCPConfig` optional fourth argument is documented as `SDKLogContext` (internal parameter name `logCtx`; same type and position as before — **not** a breaking API change).

### Breaking

- **Session storage**: `StorageAdapter` is now **append-only**. Implementations expose `append(sessionId, entries: SessionEntry[])` and `load()` returns **`SessionEntry[]`** (messages plus optional `{ $type: 'summary', ... }` compaction rows). **`save(sessionId, Message[])` is removed.** Jsonl transcripts are **append-only** with **logical truncation**: after compaction, new lines append `[summary, ...recent]`; **`loadActiveMessages()` / resume** reconstructs the chain from the **last** `summary` line only (older lines remain on disk for audit). **`SessionManager`**: removed **`saveMessages` / `appendMessage` / `resumeSession`**; use **`attachSession`**, **`loadRawEntries` / `loadActiveMessages`**, **`appendEntries`**, **`appendCompactionBoundary`**. System prompt is **not** stored in jsonl; **`saveSystemPrompt` sidecar** (`*.system.json`) holds the last primary system text for audit. **Existing pre-v2 session files are not migrated**—start fresh or re-run conversations.

### Changed

- **Subagent**: Default `AgentConfig.subagent.timeoutMs` is now **1800000ms (30 minutes)** (previously **120000ms / 2 minutes**). The main package exports **`DEFAULT_SUBAGENT_TIMEOUT_MS`** for the same value. To keep the old cap, set `subagent.timeoutMs: 120_000` (or another limit) explicitly.

### Breaking

- **AgentCallbacks**: Removed `beforeToolCall` and `afterToolCall`. Use `lifecycle.onToolCallPlanned`, `onToolExecutionEnd`, `onToolResult`, and/or `HookManager` / `hookConfigDir` for tool interception and observation.

- **Package name**: The npm package is published as `@ddlqhd/agent-sdk`. Replace `npm install agent-sdk` / `import … from 'agent-sdk'` with the scoped name. The CLI binary remains `agent-sdk` after `npm install -g @ddlqhd/agent-sdk`.

### Fixed

- **Grep**: Documented as Node/RegExp line scan (not ripgrep); default `head_limit` 250; directory listing uses `fast-glob`; respects root `.gitignore` via the `ignore` package; match lines truncate with a match-aware window; optional `glob` filters single-file paths.

### Documentation

- **Single source of truth**: Moved factual content from the root `README.md` into `docs/`; added `sdk-cli.md`, `sdk-built-in-tools.md`, `sdk-agent-loop.md`, `repository-layout.md`, and expanded `sdk-integration-recipes.md` (system prompt, memory, AskUserQuestion, tool approval, subagent, Web Demo). Root `README.md` is now installation plus a documentation index.
- Removed `docs/cc-request.json` (non-documentation artifact).

### Breaking

- **Exports**: `StreamTransformer`, `transformStream`, and `toAgentStream` are not part of the public API. The former `streaming/transform.ts` module has been removed; use `Agent.stream` for streaming.
- **Streaming**: `AgentStream` adds `finalize()` so producers that already pushed a terminal `end` can close the async iterator without emitting a duplicate `end`.

- **Stream events**: Removed `StreamEvent` variant `{ type: 'metadata'; data: ... }`.
  - **Model streaming usage** → `{ type: 'model_usage'; usage: TokenUsage; phase?: 'input' | 'output' }` (from `StreamChunk` adapters via `StreamChunkProcessor`).
  - **Agent session totals** → `{ type: 'session_summary'; usage: TokenUsage; iterations: number }` (emitted once before a successful final `end`). Session id is **not** on this variant; use `StreamEventAnnotations.sessionId` on the event (set by `Agent.stream`).
  - **Successful completion**: Final `{ type: 'end'; reason: 'complete'; ... }` no longer includes `usage`; use `session_summary.usage` as the authoritative cumulative usage for the run.
  - **Aborted / error `end`**: May still include `usage` or `partialContent` / `error` as before.

Migration:

```ts
// Before
if (event.type === 'metadata' && event.data?.usage) { /* ... */ }

// After
if (event.type === 'model_usage') {
  const u = event.usage;
}
if (event.type === 'session_summary') {
  const { usage, iterations } = event;
  const sessionId = event.sessionId; // annotations (Agent.stream)
}
```
