import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

describe('Agent passes sessionId into model stream params', () => {
  it('includes sessionId on each model.stream call', async () => {
    let captured: ModelParams | undefined;
    const model: ModelAdapter = {
      name: 'capture-params',
      async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
        captured = params;
        yield { type: 'text', content: 'done' };
        yield { type: 'done' };
      },
      async complete() {
        return { content: 'ok' };
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
    await agent.run('hello');

    expect(captured).toBeDefined();
    expect(captured!.sessionId).toBe(agent.getSessionManager().sessionId);
    expect(captured!.sessionId).toBeTruthy();
  });
});
