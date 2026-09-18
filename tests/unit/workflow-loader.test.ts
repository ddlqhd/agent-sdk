import { describe, it, expect } from 'vitest';
import { loadWorkflowScript, scanDualCompat, validateWorkflowSource } from '../../packages/agent-sdk/src/workflow/index.js';
import { WorkflowScriptError } from '../../packages/agent-sdk/src/workflow/errors.js';

describe('workflow loader', () => {
  it('extracts meta and compiles a script with top-level return', async () => {
    const source = `export const meta = {
  name: 'hello',
  description: 'A test workflow',
}

return 'ok'`;

    const loaded = loadWorkflowScript(source, 'hello.js');
    expect(loaded.meta.name).toBe('hello');
    expect(loaded.meta.description).toBe('A test workflow');

    const agent = async () => 'from-agent';
    const result = await loaded.run(
      {
        agent,
        parallel: async () => [],
        pipeline: async () => [],
        phase: () => {},
        log: () => {},
        budget: { total: null, spent: () => 0, remaining: () => Infinity },
        workflow: async () => null,
        validate: () => ({ ok: true, errors: [], warnings: [] })
      },
      null
    );
    expect(result).toBe('ok');
  });

  it('rejects scripts without export const meta', () => {
    expect(() => loadWorkflowScript('return 1', 'bad.js')).toThrow(WorkflowScriptError);
  });

  it('rejects extra import statements', () => {
    const source = `import fs from 'fs'
export const meta = { name: 'x', description: 'y' }
return 1`;
    expect(() => loadWorkflowScript(source, 'bad.js')).toThrow(/export\/import/);
  });

  it('warns on Date.now() usage', () => {
    const source = `export const meta = { name: 'x', description: 'y' }
const t = Date.now()
return t`;
    expect(scanDualCompat(source).length).toBeGreaterThan(0);
  });

  it('validateWorkflowSource returns ok for valid script', () => {
    const report = validateWorkflowSource(`export const meta = { name: 'x', description: 'y' }
return 1`);
    expect(report.ok).toBe(true);
    expect(report.meta?.name).toBe('x');
  });
});
