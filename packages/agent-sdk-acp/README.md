# @ddlqhd/agent-sdk-acp

ACP stdio bridge for [`@ddlqhd/agent-sdk`](https://github.com/ddlqhd/agent-sdk). Exposes the SDK `Agent` runtime to Zed, VS Code (ACP Client), JetBrains, and other ACP-compatible editors.

## Install

```bash
npm install @ddlqhd/agent-sdk @ddlqhd/agent-sdk-acp @agentclientprotocol/sdk zod
export OPENAI_API_KEY=...
npx agent-sdk-acp
```

## Monorepo development

```bash
# from repository root
pnpm install
pnpm build
pnpm --filter @ddlqhd/agent-sdk-acp build
node packages/agent-sdk-acp/dist/entry.js --check
```

## Environment

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI provider |
| `ANTHROPIC_API_KEY` | Anthropic provider |
| `OLLAMA_BASE_URL` | Ollama (default `http://127.0.0.1:11434`) |
| `AGENT_SDK_ACP_PROVIDER` | `openai` / `anthropic` / `ollama` |
| `AGENT_SDK_ACP_MODEL` | Override model id |
| `AGENT_SDK_ACP_USER_BASE` | Storage root (default: stable `tmpdir()/agent-sdk-acp`) |
| `AGENT_SDK_ACP_CONTEXT_SIZE` | Context window size for `usage_update` (default `200000`) |
| `AGENT_SDK_LOG_LEVEL` | `debug` for verbose stderr |

## Capabilities

- **ACP methods**: `initialize`, `session/new`, `session/load`, `session/list`, `session/fork`, `session/close`, `session/prompt`, `session/cancel`, `session/set_mode`
- **Streaming**: `Agent.stream()` → `session/update`
- **Permissions**: `canUseTool` → `session/request_permission`
- **Sessions**: per-session `Agent`, jsonl persistence, history replay on `session/load`
- **Edit modes**: `default` / `accept_edits` / `dont_ask`
- **MCP**: ACP `stdio`/`http` servers mapped to `AgentConfig.mcpServers`; also loads `{cwd}/.claude/mcp_config.json` when present

## Module map

| File | Role |
|------|------|
| `src/entry.ts` | stdio transport, signal cleanup |
| `src/server.ts` | `AgentSdkAcpBridge` (ACP `Agent` implementation) |
| `src/session-manager.ts` | Session ↔ `Agent` instances |
| `src/event-bridge.ts` | `StreamEvent` → `session/update` |
| `src/tool-render.ts` | Tool kind mapping |
| `src/permissions.ts` | `canUseTool` ↔ `request_permission` |
| `src/edit-approval.ts` | Write/Edit diff pre-approval |
| `src/agent-factory.ts` | `Agent` construction |
| `src/mcp-map.ts` | ACP MCP → SDK `MCPServerConfig` |
| `src/user-base.ts` | Stable session storage root |

## ACP Registry

[`agent.json`](./agent.json) is included for ACP Registry discovery.

## Limitations

- History replay emits user/assistant text only; standalone tool-role messages are omitted.
- ACP `sse` and `acp` MCP transports are skipped (SDK supports `stdio` and `http` only).
- `session/list` cwd filtering is best-effort; cwd comes from in-memory sessions or system-prompt sidecars when available.
- `AskUserQuestion` is disabled (no interactive resolver in stdio mode).
- Edit mode is not persisted across `session/load` (defaults to `default`).
