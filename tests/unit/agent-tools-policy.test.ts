import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import { createTool } from '../../src/tools/registry.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { z } from 'zod';

function modelThatCallsTool(toolName: string, arg: Record<string, unknown> = {}): ModelAdapter {
  return {
    name: 'policy-test-model',
    async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
      const last = params.messages[params.messages.length - 1];
      if (last?.role === 'user') {
        yield {
          type: 'tool_call',
          toolCall: {
            id: 'tc1',
            name: toolName,
            arguments: arg
          }
        };
        yield { type: 'done' };
        return;
      }
      yield { type: 'text', content: 'ok-after-tool' };
      yield { type: 'done' };
    },
    async complete() {
      return { content: 'ok' };
    }
  };
}

describe('Agent allowedTools / disallowedTools', () => {
  it('omits disallowed built-in tools from the registry', () => {
    const agent = new Agent({
      model: modelThatCallsTool('Read'),
      memory: false,
      disallowedTools: ['Bash', 'Write']
    });

    const names = agent.getToolRegistry().getAll().map(t => t.name);
    expect(names).not.toContain('Bash');
    expect(names).not.toContain('Write');
    expect(names).toContain('Read');
  });

  it('does not register custom tools whose names are disallowed', () => {
    const t = createTool({
      name: 'CustomX',
      description: 'x',
      parameters: z.object({}),
      handler: async () => ({ content: 'x' })
    });

    const agent = new Agent({
      model: modelThatCallsTool('Read'),
      memory: false,
      tools: [t],
      disallowedTools: ['CustomX']
    });

    expect(agent.getToolRegistry().has('CustomX')).toBe(false);
  });

  it('appends custom tools alongside built-ins', () => {
    const extra = createTool({
      name: 'ExtraTool',
      description: 'extra',
      parameters: z.object({}),
      handler: async () => ({ content: 'extra' })
    });

    const agent = new Agent({
      model: modelThatCallsTool('Read'),
      memory: false,
      tools: [extra]
    });

    expect(agent.getToolRegistry().has('ExtraTool')).toBe(true);
    expect(agent.getToolRegistry().has('Read')).toBe(true);
  });

  it('auto-executes when tool is in allowedTools', async () => {
    const ping = createTool({
      name: 'Ping',
      description: 'p',
      parameters: z.object({}),
      handler: async () => ({ content: 'pong' })
    });

    const agent = new Agent({
      model: modelThatCallsTool('Ping'),
      memory: false,
      tools: [ping],
      allowedTools: ['Ping']
    });

    await agent.waitForInit();
    const result = await agent.run('go');
    expect(result.content).toContain('ok-after-tool');
  });

  it('denies execution when allowedTools is set and tool is not listed and canUseTool is absent', async () => {
    const ping = createTool({
      name: 'Ping',
      description: 'p',
      parameters: z.object({}),
      handler: async () => ({ content: 'pong' })
    });

    const agent = new Agent({
      model: modelThatCallsTool('Ping'),
      memory: false,
      tools: [ping],
      allowedTools: ['OtherOnly']
    });

    await agent.waitForInit();
    const result = await agent.run('go');
    expect(result.toolCalls?.[0]?.result).toContain('requires approval');
  });

  it('allows execution via canUseTool when not in allowedTools', async () => {
    const ping = createTool({
      name: 'Ping',
      description: 'p',
      parameters: z.object({}),
      handler: async () => ({ content: 'pong' })
    });

    const canUseTool = vi.fn().mockResolvedValue(true);

    const agent = new Agent({
      model: modelThatCallsTool('Ping'),
      memory: false,
      tools: [ping],
      allowedTools: ['OtherOnly'],
      canUseTool
    });

    await agent.waitForInit();
    const result = await agent.run('go');
    expect(canUseTool).toHaveBeenCalledWith('Ping', {});
    expect(result.content).toContain('ok-after-tool');
  });

  it('registerTool throws when name is disallowed', () => {
    const agent = new Agent({
      model: modelThatCallsTool('Read'),
      memory: false,
      disallowedTools: ['Bad']
    });

    const bad = createTool({
      name: 'Bad',
      description: 'b',
      parameters: z.object({}),
      handler: async () => ({ content: 'no' })
    });

    expect(() => agent.registerTool(bad)).toThrow(/disallowedTools/);
  });
});
