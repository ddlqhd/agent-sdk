import { describe, it, expect } from 'vitest';
import { Agent, DEFAULT_MAX_ITERATIONS } from '../../src/core/agent.js';
import { createTool } from '../../src/tools/registry.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { z } from 'zod';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

const pingTool = createTool({
  name: 'Ping',
  description: 'noop',
  parameters: z.object({}),
  handler: async () => ({ content: 'pong' })
});

function createAlwaysToolModel(toolName: string): ModelAdapter {
  return {
    name: 'always-tool',
    async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
      yield {
        type: 'tool_call',
        toolCall: {
          id: `tc_${params.messages.length}`,
          name: toolName,
          arguments: {}
        }
      };
      yield { type: 'done' };
    },
    async complete() {
      return { content: '' };
    }
  };
}

describe('Agent maxIterations', () => {
  it('ends stream with reason max_iterations when the tool loop hits the cap', async () => {
    const agent = new Agent({
      model: createAlwaysToolModel('Ping'),
      exclusiveTools: [pingTool],
      maxIterations: 2,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      subagent: { enabled: false },
      contextManagement: false
    });

    const events: Array<{ type: string; reason?: string; iterations?: number }> = [];
    for await (const event of agent.stream('go')) {
      if (event.type === 'end') {
        events.push({ type: event.type, reason: event.reason });
      } else if (event.type === 'session_summary') {
        events.push({ type: event.type, iterations: event.iterations });
      } else {
        events.push({ type: event.type });
      }
    }

    const end = events.filter((e): e is { type: 'end'; reason?: string } => e.type === 'end').pop();
    expect(end?.reason).toBe('max_iterations');
    const summary = events.find((e) => e.type === 'session_summary');
    expect(summary?.iterations).toBe(2);
    expect(events.some((e) => e.type === 'tool_result')).toBe(true);
  });

  it('completes with reason complete when the model stops calling tools', async () => {
    const textOnlyModel: ModelAdapter = {
      name: 'text-only',
      async *stream(_params: ModelParams): AsyncIterable<StreamChunk> {
        yield { type: 'text', content: 'done' };
        yield { type: 'done' };
      },
      async complete() {
        return { content: 'done' };
      }
    };
    const agent = new Agent({
      model: textOnlyModel,
      exclusiveTools: [pingTool],
      maxIterations: 2,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      subagent: { enabled: false },
      contextManagement: false
    });
    let lastReason: string | undefined;
    let summaryIterations: number | undefined;
    for await (const event of agent.stream('hi')) {
      if (event.type === 'end') {
        lastReason = event.reason;
      }
      if (event.type === 'session_summary') {
        summaryIterations = event.iterations;
      }
    }
    expect(lastReason).toBe('complete');
    expect(summaryIterations).toBe(1);
  });
});

describe('DEFAULT_MAX_ITERATIONS', () => {
  it('is 400', () => {
    expect(DEFAULT_MAX_ITERATIONS).toBe(400);
  });
});
