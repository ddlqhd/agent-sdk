# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent SDK is a TypeScript library for building AI agents with:
- Multi-model support (OpenAI, Anthropic, Ollama)
- MCP (Model Context Protocol) integration for external tool servers
- Skill system for loading modular capabilities from SKILL.md files
- Streaming output via AsyncIterable
- Session persistence with JSONL storage
- Long-term memory from CLAUDE.md files

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build (ESM + CJS + types) with tsup
pnpm lint             # Type check (tsc --noEmit)
pnpm test             # Run tests in watch mode
pnpm test:run         # Run all tests once
pnpm vitest run tests/unit/tools.test.ts    # Single test file
pnpm vitest run -t "should register"        # Tests matching pattern
pnpm clean            # Remove dist/
```

## Architecture

### Core Flow
```
Agent (src/core/agent.ts)
  ├── ModelAdapter (src/models/) - OpenAI, Anthropic, Ollama
  ├── ToolRegistry (src/tools/registry.ts) - Tool management
  ├── SessionManager (src/storage/session.ts) - Conversation persistence
  ├── SkillRegistry (src/skills/registry.ts) - Skill loading/invoke
  ├── MCPAdapter (src/mcp/adapter.ts) - External MCP server tools
  └── ContextManager (src/core/context-manager.ts) - Context compression
```

### Key Abstractions

**ModelAdapter** (`src/core/types.ts:176-188`): Interface for model providers. Must implement `stream()` returning `AsyncIterable<StreamChunk>` and `complete()` returning `Promise<CompletionResult>`.

**ToolDefinition** (`src/core/types.ts:209-227`): Tools have a Zod schema for parameters and an async handler. Use `createTool()` factory function.

**SkillDefinition** (`src/core/types.ts:420-429`): Skills are instructional content loaded from SKILL.md files. They don't provide tools - only guidance.

**StreamEvent** (`src/core/types.ts:306-320`): Union type for streaming events including text_delta, tool_call, tool_result, thinking, etc.

### Module Organization

Each module follows this pattern:
- `index.ts` - Public exports
- `types.ts` - Type definitions (if needed)
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
```

### Streaming
All model adapters implement streaming via `AsyncIterable<StreamChunk>`:
```typescript
async *stream(params: ModelParams): AsyncIterable<StreamChunk>
```

### Error Handling
Always catch and return structured results:
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

Located in `src/tools/builtin/`:
- `filesystem.ts` - read_file, write_file, list_files, delete_file, file_exists
- `shell.ts` - execute_command
- `grep.ts` - grep_search
- `web.ts` - http_request, fetch_webpage, download_file
- `planning.ts` - plan_task, think
- `interaction.ts` - ask_question
- `skill-activation.ts` - activate_skill

## CLI Development

The CLI entry point is `dist/cli/index.js` (built from `src/cli/index.js`). After building, test locally:
```bash
node dist/cli/index.js --help
node dist/cli/index.js chat --model openai
```

## Git Commits

Do not include `Co-Authored-By:` lines in commit messages.

## Key Files

- `src/core/agent.ts` - Main Agent class, handles conversation loop
- `src/core/types.ts` - All type definitions
- `src/core/prompts.ts` - DEFAULT_SYSTEM_PROMPT
- `src/models/base.ts` - BaseModelAdapter with shared utilities
- `src/tools/registry.ts` - ToolRegistry and createTool
- `src/skills/registry.ts` - SkillRegistry for skill management
- `src/mcp/adapter.ts` - MCPAdapter for MCP server integration