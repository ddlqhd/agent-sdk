import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

describe('Agent resume reapplies system prompt', () => {
  it('second stream with sessionId + systemPrompt updates model messages', async () => {
    let captured: ModelParams | undefined;
    const model: ModelAdapter = {
      name: 'resume-sys',
      async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
        captured = params;
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
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

    await agent.run('first');
    const sid = agent.getSessionManager().sessionId!;

    for await (const _ of agent.stream('second', {
      sessionId: sid,
      systemPrompt: { content: 'CUSTOM_MARK_99', mode: 'replace', includeEnvironment: false }
    })) {
      // drain
    }

    expect(captured).toBeDefined();
    const sys = captured!.messages.filter((m) => m.role === 'system');
    expect(sys.length).toBeGreaterThanOrEqual(1);
    expect(String(sys[0]!.content)).toContain('CUSTOM_MARK_99');
  });
});
