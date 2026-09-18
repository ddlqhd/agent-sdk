import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Agent } from '../../packages/agent-sdk/src/core/agent.js';
import { runWorkflow, PHASE_STARTED, AGENT_STARTED, AGENT_FINISHED } from '../../packages/agent-sdk/src/workflow/index.js';
import type { AgentPrimitiveOptions, WorkflowAgentFactory } from '../../packages/agent-sdk/src/workflow/types.js';

describe('workflow runner', () => {
  it('runs fan-out-reduce with a mock agent factory', async () => {
    const source = readFileSync(
      resolve(process.cwd(), 'examples/workflows/fan-out-reduce.js'),
      'utf8'
    );

    let callCount = 0;
    const agentFactory: WorkflowAgentFactory = async (_opts?: AgentPrimitiveOptions) => {
      return {
        waitForInit: async () => {},
        run: async (prompt: string) => {
          callCount++;
          if (prompt.includes('Draft answer')) {
            return { content: `draft-${callCount}`, sessionId: 's1', iterations: 1 };
          }
          return { content: `final-from-${callCount}`, sessionId: 's1', iterations: 1 };
        }
      } as unknown as Agent;
    };

    const result = await runWorkflow(source, {
      filename: 'fan-out-reduce.js',
      args: { task: 'Explain dynamic workflows' },
      agentFactory,
      maxConcurrency: 4
    });

    expect(result.meta.name).toBe('fan-out-reduce');
    expect(typeof result.result).toBe('string');
    expect(String(result.result)).toContain('final-from');
    expect(callCount).toBe(5);

    const phaseEvents = result.events.filter((e) => e.type === PHASE_STARTED);
    expect(phaseEvents.map((e) => e.phase)).toEqual(['Draft', 'Synthesize']);

    const started = result.events.filter((e) => e.type === AGENT_STARTED);
    const finished = result.events.filter((e) => e.type === AGENT_FINISHED);
    expect(started.length).toBe(5);
    expect(finished.length).toBe(5);
  });

  it('runs a simple sequential workflow', async () => {
    const source = `export const meta = {
  name: 'sequential',
  description: 'Two-step workflow',
  phases: [{ title: 'Step1' }, { title: 'Step2' }],
}

phase('Step1')
const a = await agent('step one', { label: 'one' })
phase('Step2')
return await agent('step two: ' + a, { label: 'two' })`;

    const responses = ['alpha', 'beta'];
    let idx = 0;
    const agentFactory: WorkflowAgentFactory = async () =>
      ({
        waitForInit: async () => {},
        run: async () => ({
          content: responses[idx++] ?? 'missing',
          sessionId: 's1',
          iterations: 1
        })
      }) as unknown as Agent;

    const result = await runWorkflow(source, { agentFactory });
    expect(result.result).toBe('beta');
  });
});
