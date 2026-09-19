# Changelog

## Unreleased

## 2.0.0

First npm release of the monorepo split. `@ddlqhd/agent-sdk` **2.0.0** (from **1.0.0**); new packages `@ddlqhd/agent-sdk-cli`, `@ddlqhd/agent-sdk-exec`, `@ddlqhd/agent-sdk-control`, and `@ddlqhd/agent-sdk-acp` at **0.1.0**.

### Added

- **Packages**: `@ddlqhd/agent-sdk-cli` (binary `agent-sdk`), `@ddlqhd/agent-sdk-exec` (Environment + `agent-sdk-exec`), `@ddlqhd/agent-sdk-control` (CLI / Web / ACP kernel), `@ddlqhd/agent-sdk-acp` (ACP stdio bridge).
- **Execution plane**: `Environment` / `exec-server` for local or remote fs / process / http; protocol **1.2.0** (server must be ≥ client). Edit, HTML-to-markdown, and oversized Bash / WebFetch / MCP output spill stay on the exec host. See [`docs/sdk-exec-server.md`](./docs/sdk-exec-server.md).
- **Control kernel**: `@ddlqhd/agent-sdk-control` shared by CLI, Web, and ACP. Not a public app-server protocol. See [`docs/sdk-control.md`](./docs/sdk-control.md).
- **Logging**: `SDKLogContext`, `createSDKLogContext`, `withLogScope`, and `sdkLog()` to propagate logger config and correlation fields (`sessionId`, `runId`, `agentName`, `cwd`) without repeating `emitSDKLog` arguments across modules.
- **Logging**: `adaptMessageLogger` / `adaptConsoleLogger` for pino/winston-style loggers; public exports for `emitSDKLog` (deprecated), `sdkLog`, and helpers.
- **Logging**: `ModelParams.logContext` preferred over separate `logger` / `logLevel` / `redaction` on model requests.
- **Docs**: [sdk-log-events.md](./docs/sdk-log-events.md), [sdk-observability-matrix.md](./docs/sdk-observability-matrix.md), [sdk-observability-spike.md](./docs/sdk-observability-spike.md).
- **Observability**: `publishSdkDiagnostic` and `SDK_DIAGNOSTIC_CHANNELS` (`node:diagnostics_channel`, opt-in).
- **Session fork & rewind**: `RewindEntry` in JSONL; `SessionManager.forkSession`, `rewindSession`, `rewindToCheckpoint`, `listSessionCheckpoints`; `Agent` mirrors with `forkSession`, `rewindToCheckpoint`, `listSessionCheckpoints`, `getActiveMessageCount`; `StreamOptions.forkSession` to fork before `stream`. Lifecycle: `onSessionFork`, `onSessionRewind`. See [`docs/sdk-api-reference.md`](./docs/sdk-api-reference.md) (Rewind 集成指南).
- **CLI**: `sessions checkpoints` / `rewind` / `fork`; `sessions show --raw` displays rewind rows; `chat`/`-p` `--fork*` flags; interactive `/checkpoints`, `/rewind`, `/fork`.
- **CLI**: root-level `-p` / `--print` headless mode with stdin pipe, `--bare`, `--allowed-tools`, `--output-format`; `--continue` alias for `--resume`.
- **CLI**: slash command registry (`/help`, `/status`, `/sessions`, `/new`, `/details`, `/compact`, `/export`, `/editor`); terminal replay after rewind/fork; `!` shell prefix; `sessions list --with-active`; optional `agent-sdk tui` (Ink).
- **CLI TUI**: slash command dropdown (builtins + skills, alias prefix filter, scroll window), persistent status bar, `/status` and `/sessions` modals; thinking and tool trace stream display; `withCapturedConsoleLog` for slash output; shared `collectSessionStatus` for classic and TUI.
- **CLI TUI**: OpenCode-style message blocks with left border colors for user, assistant, thinking, tool call/result/error; tool lines use `Name: value` format; `>` input prompt.
- **CLI**: `agent-sdk web` serves the Agent Studio UI (HTTP + WebSocket `/ws`) from `@ddlqhd/agent-sdk-cli`. Defaults match `chat` (`cwd` = process cwd, `userBasePath` = homedir, jsonl sessions). Removed the standalone `examples/web-demo` app and its fixtures. Loopback-only by default: `/ws` checks browser `Origin`; non-loopback `--host` requires `--allow-remote`; shutdown closes open sockets.
- **Web UI**: checkpoint list, rewind/fork over WebSocket; `sessions:history` on resume.
- **Web UI**: assistant message body is rendered as GitHub Flavored Markdown (headings, lists, code fences, tables, links); thinking and tool cards stay plain text.

### Changed

- **CLI**: Goose-style model flags — `--provider openai|anthropic|ollama` selects the adapter; `-m, --model` is the model ID. Hidden `-M, --model-name` remains a deprecated alias for `--model`.
- **Agent**: assistant thinking blocks are persisted without a model signature when the provider omits one (e.g. Ollama); Anthropic replay still requires signature before resending to the API.
- **Agent**: session token usage is tracked only in `sessionUsage`; compression and rewind reset `contextTokens` only (cumulative `inputTokens` / `outputTokens` preserved). `ContextManager.resetUsage` renamed to **`resetContextTokens`**.
- **agent-sdk-acp**: `usage_update.used` reflects **context occupancy** (`contextTokens`), not session cumulative billing; `model_usage` output phase no longer emits `usage_update`.
- **agent-sdk-acp**: `session/fork` now uses core `Agent.forkSession` (active-chain head) instead of copying full raw JSONL; replays history to the client after fork. **Rewind is not exposed over ACP** (use CLI or `agent-sdk web`).
- Internal modules (Agent, tools, skills, MCP config, compressor, model request log) now emit via `sdkLog` and shared context; `HookManagerSdkLogContext` is an alias of `SDKLogContext`.
- `loadMCPConfig` optional fourth argument is documented as `SDKLogContext` (internal parameter name `logCtx`; same type and position as before — **not** a breaking API change).

### Breaking

- **Monorepo / CLI package**: `@ddlqhd/agent-sdk` is now a **library-only** package (no `bin`). The `agent-sdk` command ships as [`@ddlqhd/agent-sdk-cli`](./packages/agent-sdk-cli) (`npm install -g @ddlqhd/agent-sdk-cli` or `npx @ddlqhd/agent-sdk-cli`). In this repo, library sources live under `packages/agent-sdk/`, CLI under `packages/agent-sdk-cli/`.
- **CLI**: `--model` no longer selects the provider. Use `--provider openai|anthropic|ollama`. A one-release shim still treats `--model openai|anthropic|ollama` as provider (with a stderr warning) so existing scripts do not silently send that string as the model ID.
- **CLI**: removed `run` subcommand; use root-level `-p` / `--print` for non-interactive single-shot runs (e.g. `agent-sdk -p "prompt" --bare`).
- **Agent token usage**: `session_summary.usage`, `onRunEnd.usage`, and `Agent.run().usage` now report **session cumulative** input/output (mapped to `TokenUsage.promptTokens` / `completionTokens`), not a per-`stream()` run snapshot. `iterations` still counts model rounds in the current `stream()` call. Compression and rewind no longer reset cumulative input/output; only `contextTokens` resets.
- **Session storage**: `StorageAdapter` is now **append-only**. Implementations expose `append(sessionId, entries: SessionEntry[])` and `load()` returns **`SessionEntry[]`** (messages plus optional `{ $type: 'summary', ... }` compaction rows). **`save(sessionId, Message[])` is removed.** Jsonl transcripts are **append-only** with **logical truncation**: after compaction, new lines append `[summary, ...recent]`; **`loadActiveMessages()` / resume** reconstructs the chain from the **last** `summary` line only (older lines remain on disk for audit). **`SessionManager`**: removed **`saveMessages` / `appendMessage` / `resumeSession`**; use **`attachSession`**, **`loadRawEntries` / `loadActiveMessages`**, **`appendEntries`**, **`appendCompactionBoundary`**. System prompt is **not** stored in jsonl. **Existing pre-v2 session files are not migrated**—start fresh or re-run conversations.
- **Session metadata**: `cwd` / `agentName` now live on `SessionInfo` (`*.meta.json`) via **`updateSessionMeta`**. Removed **`SystemPromptSidecar`**, **`StorageAdapter.saveSystemPrompt`**, and **`SessionManager.saveSystemPrompt`**. `*.system.json` is no longer written (delete still unlinks leftovers).

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
