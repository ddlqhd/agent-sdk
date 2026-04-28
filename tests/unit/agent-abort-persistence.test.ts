import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

describe('Agent aborted-run persistence', () => {
  it('persists once when aborted before model request', async () => {
    const modelStream = vi.fn(async function* (_params: ModelParams): AsyncIterable<StreamChunk> {
      yield { type: 'text', content: 'never' };
      yield { type: 'done' };
    });
    const model: ModelAdapter = {
      name: 'abort-before-request',
      stream: modelStream,
      async complete() {
        return { content: 'x' };
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

    const saveSpy = vi.spyOn(agent.getSessionManager(), 'saveMessages');
    const ac = new AbortController();
    ac.abort();

    const events = [];
    for await (const event of agent.stream('ping', { signal: ac.signal })) {
      events.push(event);
    }

    expect(modelStream).not.toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ type: 'end', reason: 'aborted' });
  });

  it('persists once and records interruption marker when aborted during streaming', async () => {
    const model: ModelAdapter = {
      name: 'abort-mid-stream',
      async *stream(_params: ModelParams): AsyncIterable<StreamChunk> {
        yield { type: 'text', content: 'partial' };
        await new Promise(resolve => setTimeout(resolve, 5));
        yield { type: 'done' };
      },
      async complete() {
        return { content: 'x' };
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

    const saveSpy = vi.spyOn(agent.getSessionManager(), 'saveMessages');
    const ac = new AbortController();

    const events = [];
    for await (const event of agent.stream('ping', { signal: ac.signal })) {
      events.push(event);
      if (event.type === 'text_delta') {
        ac.abort();
      }
    }

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ type: 'end', reason: 'aborted' });

    const persisted = await agent.getSessionManager().resumeSession(agent.getSessionManager().sessionId!);
    expect(persisted).toContainEqual({ role: 'user', content: '[User interrupted the response]' });
  });

  it('persists once in AbortError catch path', async () => {
    const model: ModelAdapter = {
      name: 'abort-error-catch',
      async *stream(_params: ModelParams): AsyncIterable<StreamChunk> {
        throw new DOMException('aborted by model', 'AbortError');
      },
      async complete() {
        return { content: 'x' };
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

    const saveSpy = vi.spyOn(agent.getSessionManager(), 'saveMessages');
    const events = [];
    for await (const event of agent.stream('ping')) {
      events.push(event);
    }

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ type: 'end', reason: 'aborted' });
  });
});
