import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

describe('Agent.stream flow', () => {
  it('emits session_summary immediately before terminal end event', async () => {
    const model: ModelAdapter = {
      name: 'flow-order-model',
      async *stream(_params: ModelParams): AsyncIterable<StreamChunk> {
        yield { type: 'text', content: 'a' };
        yield { type: 'done' };
      },
      async complete() {
        return { content: 'a' };
      }
    };

    const agent = new Agent({
      model,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'memory' }
    });
    await agent.waitForInit();

    const types: string[] = [];
    for await (const event of agent.stream('hello')) {
      types.push(event.type);
    }

    expect(types[0]).toBe('start');
    expect(types.at(-2)).toBe('session_summary');
    expect(types.at(-1)).toBe('end');
  });

  it('passes includeRawStreamEvents through to model.stream', async () => {
    const streamSpy = vi.fn(async function* (_params: ModelParams): AsyncIterable<StreamChunk> {
      yield { type: 'text', content: 'x' };
      yield { type: 'done' };
    });
    const model: ModelAdapter = {
      name: 'raw-include',
      stream: streamSpy,
      async complete() {
        return { content: '' };
      }
    };
    const agent = new Agent({
      model,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'memory' }
    });
    await agent.waitForInit();
    for await (const _ of agent.stream('x', { includeRawStreamEvents: true })) {
      /* drain */
    }
    expect(streamSpy).toHaveBeenCalled();
    expect(streamSpy.mock.calls[0][0].includeRawStreamEvents).toBe(true);
  });
});
