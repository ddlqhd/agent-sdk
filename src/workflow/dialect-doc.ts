/** Curated one-screen digest of common orchestration patterns. */
export const PATTERNS_DIGEST = `Known orchestration patterns (pick what fits; compose freely):

1. fan-out-reduce — draft N answers in parallel, then synthesize the best one.
   phase('Draft'); const drafts = await parallel([1,2,3].map(i => () => agent(...)))
   phase('Synthesize'); return await agent('synthesize: ' + drafts.filter(Boolean).join('\\n---\\n'))

2. pipeline (multi-stage, no barrier) — stream items through stages independently.
   const out = await pipeline(items, item => agent('stage 1: ' + item), prev => agent('stage 2: ' + prev))

3. adversarial-verify — find candidates, then keep only those that survive independent refutation.
   const found = await agent('find issues', { schema: FINDINGS })
   const verdicts = await parallel(found.issues.map(f => () => agent('try to REFUTE: ' + f.title, { schema: VERDICT })))
   return found.issues.filter((f, i) => verdicts[i] && !verdicts[i].refuted)

4. loop-until-dry — keep fanning out finders until K consecutive rounds add nothing new.

5. routing — classify the request, route to the matching specialist, then grade the result.

6. tournament — N agents attempt the task with different approaches; pairwise judging picks a winner.

7. generate-and-filter — overproduce ideas in parallel, dedupe in plain code, keep what passes a rubric.`;

/** Hard rules injected into generate/repair prompts. */
export const WORKFLOW_HARD_RULES = [
  'Return ONLY JSON matching the schema; the "script" value is the COMPLETE file content.',
  'The script MUST start with: export const meta = { ... } — a PURE object literal',
  '(no variables, function calls, spreads, or template strings inside meta).',
  'meta.name: short kebab-case; meta.description: one line; declare meta.phases.',
  'Plain JavaScript only — NO TypeScript annotations, NO import/require, NO other export.',
  'Use ONLY the injected globals: agent, parallel, pipeline, phase, log, args, budget, workflow, validate.',
  'NEVER use Date.now(), Math.random(), or new Date() with no arguments.',
  'Top-level await and top-level return are allowed; the final return is the result.',
  'agent(prompt, opts) returns reply text, or a validated object when opts.schema is set.',
  'parallel() slots can be null on failure — .filter(Boolean) before using results.',
  'Do not hardcode model names unless the task explicitly needs distinct models per role.'
].join('\n- ');

/** Authoritative dialect documentation for workflow generation. */
export const DIALECT_DOC = `# Dynamic Workflow Dialect

A workflow script is plain JavaScript with these rules:

## Structure

\`\`\`js
export const meta = {
  name: 'my-workflow',
  description: 'One-line summary.',
  phases: [{ title: 'PhaseOne' }, { title: 'PhaseTwo' }],
}

phase('PhaseOne')
const result = await agent('do something')
return result
\`\`\`

## Injected globals (never import these)

| Primitive | Purpose |
|-----------|---------|
| \`agent(prompt, opts?)\` | Run one isolated Agent on a subtask; returns text or structured object when \`opts.schema\` is set |
| \`parallel(thunks)\` | Fan out thunks concurrently; failed slots become \`null\` |
| \`pipeline(items, ...stages)\` | Stream each item through async stages concurrently |
| \`phase(title)\` | Label the following work for progress display |
| \`log(message)\` | Emit a progress log event |
| \`args\` | Run arguments injected by the caller |
| \`budget\` | \`{ total, spent(), remaining() }\` token budget |
| \`workflow(nameOrRef, args?)\` | Run a nested workflow (one level deep) |
| \`validate(source)\` | Compile-check a workflow source without executing it |

## agent() options

\`\`\`js
await agent('prompt', {
  label: 'short-label',
  phase: 'OverridePhase',
  schema: zodSchema,
  model: 'gpt-4o-mini',
  systemPrompt: 'optional override',
})
\`\`\`

## Rules

- Only \`export const meta = { ... }\` at the top; no other import/export
- Top-level \`await\` and top-level \`return\` are allowed
- Filter \`parallel()\` results with \`.filter(Boolean)\` before use
- Avoid \`Date.now()\`, \`Math.random()\`, arg-less \`new Date()\`
`;
