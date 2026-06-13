import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

function usageModel(
  rounds: Array<{ input: number; output: number }>
): ModelAdapter {
  let call = 0;
  return {
    name: 'usage-model',
    async *stream(_params: ModelParams): AsyncIterable<StreamChunk> {
      const u = rounds[call] ?? { input: 0, output: 0 };
      call++;
      if (u.input > 0) {
        yield {
          type: 'metadata',
          usagePhase: 'input',
          metadata: {
            usage: { promptTokens: u.input, completionTokens: 0, totalTokens: u.input }
          }
        };
      }
      if (u.output > 0) {
        yield {
          type: 'metadata',
          usagePhase: 'output',
          metadata: {
            usage: { promptTokens: 0, completionTokens: u.output, totalTokens: u.output }
          }
        };
      }
      yield { type: 'text', content: 'ok' };
      yield { type: 'done' };
    },
    async complete() {
      return { content: 'ok' };
    }
  };
}

describe('Agent session usage', () => {
  it('accumulates input/output across model_usage events', async () => {
    const agent = new Agent({
      model: usageModel([{ input: 100, output: 50 }]),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'memory' },
      contextManagement: false
    });
    await agent.waitForInit();

    for await (const _ of agent.stream('hi')) {
      /* drain */
    }

    const usage = agent.getSessionUsage();
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
    expect(usage.totalTokens).toBe(150);
    expect(usage.contextTokens).toBe(100);
  });

  it('session_summary.usage matches getSessionUsage mapping', async () => {
    const agent = new Agent({
      model: usageModel([{ input: 200, output: 80 }]),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'memory' },
      contextManagement: false
    });
    await agent.waitForInit();

    let summaryUsage:
      | { promptTokens: number; completionTokens: number; totalTokens: number }
      | undefined;
    for await (const event of agent.stream('hi')) {
      if (event.type === 'session_summary') {
        summaryUsage = event.usage;
      }
    }

    const session = agent.getSessionUsage();
    expect(summaryUsage).toEqual({
      promptTokens: session.inputTokens,
      completionTokens: session.outputTokens,
      totalTokens: session.totalTokens
    });
  });

  it('accumulates usage across multiple stream() calls on the same session', async () => {
    const agent = new Agent({
      model: usageModel([
        { input: 100, output: 40 },
        { input: 150, output: 60 }
      ]),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'memory' },
      contextManagement: false
    });
    await agent.waitForInit();

    for await (const _ of agent.stream('first')) {
      /* drain */
    }
    for await (const _ of agent.stream('second')) {
      /* drain */
    }

    const usage = agent.getSessionUsage();
    expect(usage.inputTokens).toBe(250);
    expect(usage.outputTokens).toBe(100);
    expect(usage.totalTokens).toBe(350);
  });

  it('rewind preserves cumulative input/output and clears contextTokens', async () => {
    const agent = new Agent({
      model: usageModel([
        { input: 100, output: 50 },
        { input: 150, output: 60 }
      ]),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'memory' },
      contextManagement: false
    });
    await agent.waitForInit();

    for await (const _ of agent.stream('first')) {
      /* drain */
    }
    for await (const _ of agent.stream('second')) {
      /* drain */
    }

    const beforeRewind = agent.getSessionUsage();
    expect(beforeRewind.inputTokens).toBe(250);
    expect(beforeRewind.outputTokens).toBe(110);
    expect(beforeRewind.contextTokens).toBe(150);

    await agent.rewindToCheckpoint({ userTurnIndex: 0 });

    const afterRewind = agent.getSessionUsage();
    expect(afterRewind.inputTokens).toBe(250);
    expect(afterRewind.outputTokens).toBe(110);
    expect(afterRewind.contextTokens).toBe(0);
  });
});
