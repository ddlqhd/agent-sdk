# agent-sdk Web Demo

Local **Node.js** server with **WebSocket** (`/ws`) plus a **Vite + TypeScript** UI. The browser never sees API keys; configure providers via environment variables on the machine running the server.

## Prerequisites

1. From the **repository root** (`agent-sdk/`), build the library:

   ```bash
   pnpm install
   pnpm build
   ```

2. Install demo dependencies (this folder lives under a repo that has a pnpm workspace file, so use `--ignore-workspace`):

   ```bash
   cd examples/web-demo
   pnpm install --ignore-workspace
   ```

   Or run `npm install` in the same directory if you prefer.

## Run (development)

Starts the API server on **3001** and Vite on **5173** (Vite proxies WebSocket `/ws` → 3001).

```bash
cd examples/web-demo
pnpm dev
```

Open `http://127.0.0.1:5173`, click **Apply configuration**, then chat.

## Environment variables

| Variable            | When needed        |
|---------------------|--------------------|
| `OPENAI_API_KEY`    | Provider: OpenAI   |
| `ANTHROPIC_API_KEY` | Provider: Anthropic |
| `OLLAMA_BASE_URL`   | Optional; default `http://127.0.0.1:11434` |

## Capabilities surfaced in the UI

- **Models**: OpenAI, Anthropic, Ollama via `createModel` / `Agent`
- **Streaming**: `Agent.stream()` → serialized `StreamEvent`s in the event panel
- **Non-streaming**: optional `Agent.run()` checkbox
- **Sessions**: new / list / resume; storage **memory** or **jsonl** (under a temp or custom user base path)
- **Tools**: all built-ins by default, or **safe** mode (strip `isDangerous` tools + **DemoCalculator**)
- **Skills**: [`demo-fixtures/.claude/skills/DemoSkill/SKILL.md`](demo-fixtures/.claude/skills/DemoSkill/SKILL.md) — try asking the model to use the **Skill** tool with `DemoSkill`
- **Memory**: [`demo-fixtures/CLAUDE.md`](demo-fixtures/CLAUDE.md) when “Long-term memory” is on
- **Context compression**: toggle maps to `contextManagement` on the agent
- **MCP**: optional path to a Claude Desktop–style JSON file (`mcpServers`). Start from [`demo-fixtures/mcp.demo.json`](demo-fixtures/mcp.demo.json); add a stdio or HTTP server block as in the MCP SDK docs. Connection failures are logged on the server; the UI shows load/validation warnings.

Hook profiles (`.claude/settings.json`) and the `agent-sdk` CLI are not part of this UI; they remain compatible with the same library when used from Node.

## Production-style run

Build the client, then serve static assets from the same Node process (set `NODE_ENV=production` so static files are served from `client/dist`):

```bash
cd examples/web-demo
pnpm build
NODE_ENV=production pnpm start
```

Open `http://127.0.0.1:3001` (WebSocket at `ws://127.0.0.1:3001/ws`).

## Security notes

- **Dangerous tools** (e.g. **Bash**) are available when “Safe tools only” is off. Use only on trusted machines.
- This demo is for local development, not for exposing to the internet without hardening.
