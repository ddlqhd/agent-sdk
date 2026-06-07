# Agent SDK ACP Bridge (local dev entry)

This directory is a **thin wrapper** around the publishable package [`@ddlqhd/agent-sdk-acp`](../../packages/agent-sdk-acp). Implementation lives in `packages/agent-sdk-acp/src/`.

## Prerequisites

From the repository root:

```bash
pnpm install
pnpm build
pnpm --filter @ddlqhd/agent-sdk-acp build
```

## Run

```bash
cd examples/acp-bridge
pnpm start
```

Stdout is reserved for JSON-RPC; logs go to **stderr**.

Preflight:

```bash
pnpm run check
```

## Environment

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI provider |
| `ANTHROPIC_API_KEY` | Anthropic provider |
| `OLLAMA_BASE_URL` | Ollama (default `http://127.0.0.1:11434`) |
| `OLLAMA_MODEL` | Ollama model id |
| `AGENT_SDK_ACP_PROVIDER` | `openai` / `anthropic` / `ollama` (auto-detect if unset) |
| `AGENT_SDK_ACP_MODEL` | Override model id |
| `AGENT_SDK_ACP_USER_BASE` | Session/skill storage root (default: stable `tmpdir()/agent-sdk-acp`) |
| `AGENT_SDK_LOG_LEVEL` | SDK log level (`debug` enables verbose stderr) |

## Zed / editor configuration

```json
{
  "command": "node",
  "args": ["ABS_PATH/to/agent-sdk/packages/agent-sdk-acp/dist/entry.js"],
  "env": {
    "OPENAI_API_KEY": "..."
  }
}
```

Or after publish:

```bash
npx @ddlqhd/agent-sdk-acp
```

See [`packages/agent-sdk-acp/README.md`](../../packages/agent-sdk-acp/README.md) for the full module map and capabilities.

## Limitations

- History replay emits user/assistant text only; standalone tool-role messages are omitted.
- ACP `sse` and `acp` MCP transports are skipped (SDK supports `stdio` and `http` only).
- `session/list` cwd filtering is best-effort; cwd comes from in-memory sessions or system-prompt sidecars when available.
- `AskUserQuestion` is disabled (no interactive resolver in stdio mode).
- Edit mode is not persisted across `session/load` (defaults to `default`).
- `session/fork` uses the core SDK active-chain fork (not full raw JSONL copy). **Rewind** is not available over ACP; use CLI or web-demo.
