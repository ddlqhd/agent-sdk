import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import { createTool } from '../../src/tools/registry.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { z } from 'zod';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createSubagentTestModel(): ModelAdapter {
  return {
    name: 'subagent-test-model',
    async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
      const lastMessage = params.messages[params.messages.length - 1];
      if (!lastMessage) {
        yield { type: 'text', content: 'empty' };
        yield { type: 'done' };
        return;
      }

      if (lastMessage.role === 'user' && typeof lastMessage.content === 'string') {
        if (lastMessage.content.includes('[parent-delegate]')) {
          yield {
            type: 'tool_call',
            toolCall: {
              id: 'tc_parent',
              name: 'Agent',
              arguments: {
                prompt: 'child-task'
              }
            }
          };
          yield { type: 'done' };
          return;
        }
        if (lastMessage.content.includes('slow-child')) {
          await sleep(80);
          yield { type: 'text', content: 'slow child done' };
          yield { type: 'done' };
          return;
        }
        yield { type: 'text', content: `child:${lastMessage.content}` };
        yield { type: 'done' };
        return;
      }

      if (lastMessage.role === 'tool' && typeof lastMessage.content === 'string') {
        yield { type: 'text', content: `parent:${lastMessage.content}` };
        yield { type: 'done' };
        return;
      }

      yield { type: 'text', content: 'ok' };
      yield { type: 'done' };
    },
    async complete() {
      return { content: 'ok' };
    }
  };
}

describe('Agent subagent tool integration', () => {
  it('delegates to subagent and writes tool result back', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false
    });

    const result = await agent.run('[parent-delegate]');
    expect(result.content).toContain('parent:child:child-task');
  });

  it('blocks nested subagent calls by depth', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false
    });

    const result = await agent.getToolRegistry().execute(
      'Agent',
      { prompt: 'nested task' },
      { agentDepth: 1 }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('cannot spawn subagents');
  });

  it('enforces timeout and returns tool error text', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      subagent: {
        timeoutMs: 20
      }
    });

    const result = await agent.getToolRegistry().execute('Agent', {
      prompt: 'slow-child',
      timeout_ms: 1000
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('timed out');
  });

  it('excludes AskUserQuestion from subagent toolset', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false
    });
    expect(agent.getToolRegistry().getAll().some((t) => t.name === 'AskUserQuestion')).toBe(true);

    const result = await agent.getToolRegistry().execute('Agent', {
      prompt: 'child-task'
    });

    expect(result.isError).toBeFalsy();
    const toolNames = result.metadata?.toolNames as string[] | undefined;
    expect(toolNames).toBeDefined();
    expect(toolNames).not.toContain('AskUserQuestion');
  });

  it('uses safe tools by default for child toolset', async () => {
    const dangerousTool = createTool({
      name: 'DangerousExec',
      description: 'danger',
      parameters: z.object({}),
      handler: async () => ({ content: 'danger' }),
      isDangerous: true
    });
    const safeTool = createTool({
      name: 'SafeEcho',
      description: 'safe',
      parameters: z.object({ text: z.string().optional() }),
      handler: async ({ text }) => ({ content: text ?? 'safe' })
    });

    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      tools: [dangerousTool, safeTool]
    });

    const result = await agent.getToolRegistry().execute('Agent', {
      prompt: 'child-task'
    });

    expect(result.isError).toBeFalsy();
    const toolNames = (result.metadata as { toolNames?: string[] } | undefined)?.toolNames ?? [];
    expect(toolNames).toContain('SafeEcho');
    expect(toolNames).not.toContain('DangerousExec');
    expect(toolNames).not.toContain('Agent');
  });
});

