# Changelog

## Unreleased

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
