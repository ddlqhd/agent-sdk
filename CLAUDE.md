# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent SDK is a TypeScript library for building AI agents with:
- Multi-model support (OpenAI, Anthropic, Ollama) via `createModel()` / `createOpenAI`, `createAnthropic`, `createOllama`
- MCP (Model Context Protocol) integration for external tool servers (`MCPClient`, `MCPAdapter`, optional `mcp_config.json`)
- Skill system for loading modular capabilities from SKILL.md files
- Streaming output via AsyncIterable and helpers in `src/streaming/`
- Session persistence with JSONL or in-memory storage
- Long-term memory from CLAUDE.md files (`MemoryManager`: user `~/.claude/CLAUDE.md` and workspace `./CLAUDE.md`)

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build (ESM + CJS + types) with tsup
pnpm dev              # Watch mode build (tsup --watch)
pnpm lint             # Type check (tsc --noEmit)
pnpm test             # Run tests in watch mode
pnpm test:run         # Run all tests once
pnpm vitest run tests/unit/tools.test.ts    # Single test file
pnpm vitest run -t "should register"          # Tests matching pattern
pnpm clean            # Remove dist/
```

Requires Node.js >= 18 (see `package.json` `engines`).

## Architecture

### Core Flow

```
Agent (src/core/agent.ts)
  ├── ModelAdapter (src/models/) — OpenAI, Anthropic, Ollama
  ├── ToolRegistry (src/tools/registry.ts) — tool management
  ├── SessionManager (src/storage/session.ts) — conversation persistence
  ├── SkillRegistry + templates (src/skills/) — skills and SKILL.md processing
  ├── MemoryManager (src/memory/manager.ts) — CLAUDE.md long-term memory
  ├── MCPAdapter / MCPClient (src/mcp/) — external MCP server tools
  ├── ContextManager + compressor (src/core/context-manager.ts, src/core/compressor.ts) — context compression
  └── Environment hints (src/core/environment.ts) — optional workspace context for the system prompt
```

### Key Abstractions

**ModelAdapter** (`src/core/types.ts` ~193–205): Interface for model providers. Implement `stream()` as `AsyncIterable<StreamChunk>` and `complete()` as `Promise<CompletionResult>`.

**ToolDefinition** (`src/core/types.ts` ~246–264): Tools use a Zod schema for parameters and an async handler. Use `createTool()` from `src/tools/registry.ts`.

**SkillDefinition** (`src/core/types.ts` ~453+): Skills are instructional content loaded from SKILL.md files. They do not provide tools—only guidance.

**StreamEvent** (`src/core/types.ts` ~339+): Union type for streaming events (e.g. text deltas, tool calls, tool results, thinking).

### Public package exports

The root `src/index.ts` re-exports core types, models, tools, storage, streaming (`AgentStream`, `StreamChunkProcessor`, etc.), MCP, skills, memory (`MemoryManager`), and MCP config helpers (`loadMCPConfig`, `validateMCPConfig`). Subpath exports: `@ddlqhd/agent-sdk/models`, `@ddlqhd/agent-sdk/tools` (see `package.json` `exports`).

### Module Organization

Each module follows this pattern:
- `index.ts` — public exports
- `types.ts` — type definitions (if needed)
- Main implementation files

**Important**: Internal imports use `.js` extension for ESM compatibility:

```typescript
import { ToolRegistry } from '../tools/registry.js';
```

## Code Patterns

### Factory Functions

Use `create*` prefix for factory functions:

```typescript
export function createTool(config: ToolConfig): ToolDefinition
export function createOpenAI(config?: OpenAIConfig): ModelAdapter
export function createSkillRegistry(): SkillRegistry
export function createModel(config: CreateModelConfig): ModelAdapter
```

### Streaming

Model adapters implement streaming via `AsyncIterable<StreamChunk>`:

```typescript
stream(params: ModelParams): AsyncIterable<StreamChunk>
```

### Error Handling

Catch and return structured results:

```typescript
try {
  const content = await fs.readFile(path, 'utf-8');
  return { content };
} catch (error) {
  return {
    content: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
    isError: true
  };
}
```

### Tool Registration

```typescript
const tool = createTool({
  name: 'tool_name',
  description: 'Description for the model',
  parameters: z.object({
    path: z.string().describe('Parameter description')
  }),
  handler: async ({ path }) => ({ content: 'result' }),
  isDangerous: true,  // Optional: mark dangerous tools
  category: 'filesystem'  // Optional: group tools
});
```

## Built-in Tools

Tool **names** are PascalCase / multi-word identifiers (what the model sees), defined in `src/tools/builtin/`:

- `filesystem.ts` — **Read**, **Write**, **Edit**, **Glob**
- `shell.ts` — **Bash** (marked `isDangerous: true`)
- `grep.ts` — **Grep**
- `web.ts` — **WebFetch**, **WebSearch** (Tavily when `TAVILY_API_KEY` is set; otherwise stub — see `tavily-search.ts`)
- `task.ts` — **TaskCreate**, **TaskUpdate**, **TaskList**
- `interaction.ts` — **AskUserQuestion**
- `skill-activation.ts` — **Skill** (invokes a registered skill by name)

`getAllBuiltinTools(skillRegistry)` and `getSafeBuiltinTools(skillRegistry)` aggregate these (see `src/tools/builtin/index.ts`). Safe mode excludes tools with `isDangerous` (currently **Bash**).

## CLI Development

Source entry: `src/cli/index.ts` (built to `dist/cli/index.js`). The npm binary name is `agent-sdk` (`package.json` `bin`).

Subcommands include `chat`, `run`, `tools`, `sessions`, and `mcp`. After building:

```bash
pnpm build
node dist/cli/index.js --help
agent-sdk chat --model openai
agent-sdk run "Your prompt" --model openai
```

CLI options include model provider, API keys, session id, MCP config path (`--mcp-config`), cwd, and user base path for config/memory resolution.

## Git Commits

Do not include `Co-Authored-By:` lines in commit messages.

## Key Files

- `src/core/agent.ts` — Agent class, conversation loop
- `src/core/types.ts` — shared type definitions
- `src/core/prompts.ts` — `DEFAULT_SYSTEM_PROMPT`
- `src/core/environment.ts` — environment section for prompts
- `src/models/base.ts` — `BaseModelAdapter` shared utilities
- `src/models/index.ts` — `createModel` and provider factories
- `src/tools/registry.ts` — `ToolRegistry` and `createTool`
- `src/skills/registry.ts`, `src/skills/template.ts` — skills and template processing
- `src/memory/manager.ts` — `MemoryManager` for CLAUDE.md memory
- `src/mcp/adapter.ts`, `src/mcp/client.ts` — MCP integration
- `src/config/mcp-config.ts` — loading/validating MCP JSON config
- `src/streaming/event-emitter.ts`, `src/streaming/chunk-processor.ts` — stream helpers
- `tsup.config.ts` — build entries (library + CLI)
