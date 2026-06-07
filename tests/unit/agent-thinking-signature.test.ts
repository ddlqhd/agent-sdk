import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import type { Message, ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

describe('Agent thinking signature persistence', () => {
  it('persists assistant thinking block with signature for multi-turn replay', async () => {
    let turn = 0;
    let capturedMessages: Message[] | undefined;

    const model: ModelAdapter = {
      name: 'thinking-signature-roundtrip',
      async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
        turn += 1;
        if (turn === 1) {
          yield { type: 'thinking', content: 'trace' };
          yield { type: 'thinking', signature: 'sig-roundtrip' };
          yield { type: 'text', content: 'hello' };
          yield { type: 'done' };
          return;
        }
        capturedMessages = params.messages;
        yield { type: 'text', content: 'world' };
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

    for await (const _ of agent.stream('first')) {
      // drain
    }
    for await (const _ of agent.stream('second')) {
      // drain
    }

    expect(capturedMessages).toBeDefined();
    const assistant = capturedMessages!.find(m => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(Array.isArray(assistant!.content)).toBe(true);
    if (Array.isArray(assistant!.content)) {
      expect(assistant!.content[0]).toMatchObject({
        type: 'thinking',
        thinking: 'trace',
        signature: 'sig-roundtrip'
      });
      expect(assistant!.content[1]).toMatchObject({ type: 'text', text: 'hello' });
    }
  });

  it('omits thinking block from history when signature never arrived', async () => {
    let turn = 0;
    let capturedMessages: Message[] | undefined;

    const model: ModelAdapter = {
      name: 'thinking-no-signature',
      async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
        turn += 1;
        if (turn === 1) {
          yield { type: 'thinking', content: 'trace' };
          yield { type: 'text', content: 'hello' };
          yield { type: 'done' };
          return;
        }
        capturedMessages = params.messages;
        yield { type: 'text', content: 'world' };
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

    for await (const _ of agent.stream('first')) {
      // drain
    }
    for await (const _ of agent.stream('second')) {
      // drain
    }

    const assistant = capturedMessages!.find(m => m.role === 'assistant');
    expect(assistant!.content).toBe('hello');
  });
});
