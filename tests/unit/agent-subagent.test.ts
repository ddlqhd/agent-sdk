import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import { createTool } from '../../src/tools/registry.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { z } from 'zod';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

/** User message used only in tests that assert explore / system-prompt behavior (avoids colliding with `child-task` from parent delegation). */
const SUBAGENT_PROBE_PROMPT = '__sdk_subagent_probe__';

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
        if (lastMessage.content === SUBAGENT_PROBE_PROMPT) {
          const sysText = params.messages
            .filter((m) => m.role === 'system')
            .map((m) => (typeof m.content === 'string' ? m.content : ''))
            .join('\n');
          if (sysText.includes('Subagent role: explore')) {
            if (sysText.includes('CUSTOM_USER_HINT')) {
              yield { type: 'text', content: 'explore-with-custom-user' };
            } else {
              yield { type: 'text', content: 'explore-system-ok' };
            }
            yield { type: 'done' };
            return;
          }
          if (sysText.includes('OVERRIDE_PROMPT')) {
            yield { type: 'text', content: 'override-ok' };
            yield { type: 'done' };
            return;
          }
          yield { type: 'text', content: `child:${lastMessage.content}` };
          yield { type: 'done' };
          return;
        }
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
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD
    });

    const result = await agent.run('[parent-delegate]');
    expect(result.content).toContain('parent:child:child-task');
  });

  it('blocks nested subagent calls by depth', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD
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
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
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
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD
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
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
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

  it('appends explore profile to child system prompt', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD
    });

    const result = await agent.getToolRegistry().execute('Agent', {
      prompt: SUBAGENT_PROBE_PROMPT,
      subagent_type: 'explore'
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('explore-system-ok');
  });

  it('merges explore append with request.system_prompt after type fragment', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD
    });

    const result = await agent.getToolRegistry().execute('Agent', {
      prompt: SUBAGENT_PROBE_PROMPT,
      subagent_type: 'explore',
      system_prompt: 'CUSTOM_USER_HINT'
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('explore-with-custom-user');
  });

  it('respects subagent.subagentTypePrompts override for explore', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      subagent: {
        subagentTypePrompts: {
          explore: 'OVERRIDE_PROMPT'
        }
      }
    });

    const result = await agent.getToolRegistry().execute('Agent', {
      prompt: SUBAGENT_PROBE_PROMPT,
      subagent_type: 'explore'
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('override-ok');
  });

  it('uses read-oriented default tools for explore when no allowlist', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD
    });

    const result = await agent.getToolRegistry().execute('Agent', {
      prompt: SUBAGENT_PROBE_PROMPT,
      subagent_type: 'explore'
    });

    expect(result.isError).toBeFalsy();
    const toolNames = (result.metadata as { toolNames?: string[] } | undefined)?.toolNames ?? [];
    expect(new Set(toolNames)).toEqual(
      new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'])
    );
  });

  it('does not apply explore default tools when allowed_tools is explicit', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD
    });

    const result = await agent.getToolRegistry().execute('Agent', {
      prompt: SUBAGENT_PROBE_PROMPT,
      subagent_type: 'explore',
      allowed_tools: ['Read']
    });

    expect(result.isError).toBeFalsy();
    const toolNames = (result.metadata as { toolNames?: string[] } | undefined)?.toolNames ?? [];
    expect(toolNames).toEqual(['Read']);
  });

  it('fails explore with a clear error when parent has none of the default explore tools', async () => {
    const onlyCustom = createTool({
      name: 'OnlyCustom',
      description: 'custom',
      parameters: z.object({}),
      handler: async () => ({ content: 'ok' })
    });
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [onlyCustom]
    });

    const result = await agent.getToolRegistry().execute('Agent', {
      prompt: SUBAGENT_PROBE_PROMPT,
      subagent_type: 'explore'
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Explore subagent:');
    expect(result.content).toContain('allowed_tools');
  });
});

