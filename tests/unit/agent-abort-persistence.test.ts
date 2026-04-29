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

  it('preserves thinking and emits partialContent when aborted during streaming', async () => {
    const model: ModelAdapter = {
      name: 'abort-mid-stream-thinking',
      async *stream(_params: ModelParams): AsyncIterable<StreamChunk> {
        yield { type: 'thinking', content: 'thought' };
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

    const ac = new AbortController();
    let endEvent: { type: string; reason?: string; partialContent?: string } | undefined;
    const events = [];
    for await (const event of agent.stream('ping', { signal: ac.signal })) {
      events.push(event);
      if (event.type === 'text_delta') {
        ac.abort();
      }
      if (event.type === 'end') {
        endEvent = event;
      }
    }

    expect(events.some(event => event.type === 'thinking')).toBe(true);
    expect(endEvent).toMatchObject({ type: 'end', reason: 'aborted', partialContent: 'partial' });

    const persisted = await agent.getSessionManager().resumeSession(agent.getSessionManager().sessionId!);
    const assistantMsg = [...persisted].reverse().find(m => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(Array.isArray(assistantMsg!.content)).toBe(true);
    if (Array.isArray(assistantMsg!.content)) {
      expect(assistantMsg!.content[0]).toMatchObject({ type: 'thinking', thinking: 'thought' });
      expect(assistantMsg!.content[1]).toMatchObject({ type: 'text', text: 'partial' });
    }
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
