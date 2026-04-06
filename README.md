# Agent SDK

A TypeScript library for building AI agents with multi-model support (OpenAI, Anthropic, Ollama), MCP integration, a skill system, tool registration, session persistence, and streaming.

**Integration policy:** Application code should drive execution through **`Agent`** (`run` / `stream`). Use `createOpenAI`, `createAnthropic`, `createOllama`, or `createModel` only to build the `model` passed into `Agent`. Do not call `ModelAdapter` methods such as `stream()` or `complete()` directly in product code (bypassing `Agent`). See [`docs/sdk-overview.md`](docs/sdk-overview.md) section 3.

## Features

- Multi-model support: OpenAI, Anthropic, Ollama
- Built-in tools plus custom tools (Zod-validated parameters)
- MCP servers (stdio / HTTP) mapped to tools
- Skills loaded from `SKILL.md`
- JSONL or in-memory session storage
- Long-term memory from `CLAUDE.md`
- Streaming via `AsyncIterable` / `StreamEvent`
- Optional CLI for trying the SDK (`agent-sdk`)

## Requirements

- **Node.js** >= 18 (see [`package.json`](package.json) `engines`)

## Installation

```bash
npm install @ddlqhd/agent-sdk
```

```bash
pnpm add @ddlqhd/agent-sdk
```

## Documentation

Factual guides and API references live under **`docs/`** (single source of truth). Start here:

| Topic | Document |
|--------|----------|
| Overview, export boundaries, integration rules | [`docs/sdk-overview.md`](docs/sdk-overview.md) |
| Quick start | [`docs/sdk-quickstart.md`](docs/sdk-quickstart.md) |
| Agent loop (`iteration`, tool cycles) | [`docs/sdk-agent-loop.md`](docs/sdk-agent-loop.md) |
| Built-in tools catalog | [`docs/sdk-built-in-tools.md`](docs/sdk-built-in-tools.md) |
| Recipes (tools, MCP, skills, memory, prompts, approval, subagent) | [`docs/sdk-integration-recipes.md`](docs/sdk-integration-recipes.md) |
| API reference | [`docs/sdk-api-reference.md`](docs/sdk-api-reference.md) |
| Types (`StreamEvent`, etc.) | [`docs/sdk-types-reference.md`](docs/sdk-types-reference.md) |
| CLI | [`docs/sdk-cli.md`](docs/sdk-cli.md) |
| Tool hooks | [`docs/tool-hook-mechanism.md`](docs/tool-hook-mechanism.md) |
| Troubleshooting | [`docs/sdk-troubleshooting.md`](docs/sdk-troubleshooting.md) |
| Examples & Web Demo index | [`docs/sdk-examples-index.md`](docs/sdk-examples-index.md) |
| Repository layout (contributors) | [`docs/repository-layout.md`](docs/repository-layout.md) |

## License

MIT
