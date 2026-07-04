# Dynamic Workflow

Agent SDK supports **dynamic workflows**: JavaScript dialect scripts that orchestrate multiple isolated `Agent` runs with `parallel`, `pipeline`, and other injected primitives.

## Overview

A workflow has two phases:

1. **Generate** — `generateWorkflow(task)` uses an `Agent` to author a dialect script, validate it, and repair up to 3 times.
2. **Execute** — `runWorkflow(source)` compiles the script and runs it in-process with injected primitives.

Generation and execution are **separate steps**. Review a generated script before running it against your workspace.

## Workflow script format

```js
export const meta = {
  name: 'fan-out-reduce',
  description: 'Draft N answers in parallel, then synthesize the best one.',
  phases: [{ title: 'Draft' }, { title: 'Synthesize' }],
}

phase('Draft')
const drafts = await parallel(
  [1, 2, 3].map((i) => () => agent(`Draft #${i}`, { label: `draft-${i}` }))
)

phase('Synthesize')
return await agent('Synthesize from:\n' + drafts.filter(Boolean).join('\n---\n'))
```

Rules:

- Start with `export const meta = { ... }` (pure object literal)
- Plain JavaScript only — no TypeScript, no `import`/`require`
- Use injected globals: `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, `budget`, `workflow`, `validate`
- Top-level `await` and top-level `return` are allowed
- Filter `parallel()` results with `.filter(Boolean)` before use

## Programmatic API

```typescript
import {
  generateWorkflow,
  runWorkflow,
  validateWorkflowSource,
} from '@ddlqhd/agent-sdk';

// 1. Generate (does not execute the business task)
const generated = await generateWorkflow('Research and summarize topic X', {
  modelConfig: { provider: 'openai', model: 'gpt-4o-mini' },
});

console.log(generated.script);
console.log(generated.meta);

// 2. Optional: compile-check only
const report = validateWorkflowSource(generated.script);
if (!report.ok) {
  console.error(report.errors);
}

// 3. Execute after review
const run = await runWorkflow(generated.script, {
  modelConfig: { provider: 'openai', model: 'gpt-4o' },
  args: { topic: 'X' },
  maxConcurrency: 4,
  budget: 100_000,
});

console.log(run.result);
```

### Custom agent factory (tests / advanced)

```typescript
import { runWorkflow } from '@ddlqhd/agent-sdk';
import { Agent } from '@ddlqhd/agent-sdk';

const result = await runWorkflow(source, {
  agentFactory: async () => new Agent({ modelConfig: { provider: 'openai' } }),
});
```

## CLI

```bash
# Generate a workflow script
agent-sdk workflow generate "Compare three approaches and pick the best"

# Save to file
agent-sdk workflow generate "..." -o my-workflow.js

# Run a workflow script
agent-sdk workflow run examples/workflows/fan-out-reduce.js --args '{"task":"hello"}'

# Model options (same as chat/run)
agent-sdk workflow run my-workflow.js -m openai -M gpt-4o-mini
```

## Injected primitives

| Primitive | Description |
|-----------|-------------|
| `agent(prompt, opts?)` | Run one isolated `Agent`; returns text or structured JSON when `opts.schema` is set |
| `parallel(thunks)` | Concurrent fan-out; failed slots become `null` |
| `pipeline(items, ...stages)` | Per-item async chains, items run concurrently |
| `phase(title)` | Progress label + event |
| `log(message)` | Log event |
| `args` | Caller-provided run arguments |
| `budget` | `{ total, spent(), remaining() }` token budget |
| `workflow(nameOrRef, args?)` | Nested workflow (one level) |
| `validate(source)` | Compile-check without executing |

## Events

`runWorkflow` returns a `WorkflowRunResult` with an `events` array when using the default in-memory sink:

- `run_started` / `run_finished` / `run_failed`
- `phase_started`
- `agent_started` / `agent_finished` / `agent_failed`
- `log`

## Subpath export

```typescript
import { runWorkflow } from '@ddlqhd/agent-sdk/workflow';
```

## Example

See [`examples/workflows/fan-out-reduce.js`](../examples/workflows/fan-out-reduce.js).
