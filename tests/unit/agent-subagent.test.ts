import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import { createTool } from '../../src/tools/registry.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { z } from 'zod';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

/** User message used only in tests that assert explore / system-prompt behavior (avoids colliding with `child-task` from parent delegation). */
const SUBAGENT_PROBE_PROMPT = '__sdk_subagent_probe__';

/** Asserts subagent default system prompt omits Skills section (loadSkills: false). */
const SUBAGENT_NO_SKILLS_PROMPT = '__sdk_subagent_no_skills_probe__';

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
        if (lastMessage.content === SUBAGENT_NO_SKILLS_PROMPT) {
          const sysText = params.messages
            .filter((m) => m.role === 'system')
            .map((m) => (typeof m.content === 'string' ? m.content : ''))
            .join('\n');
          const leaked =
            sysText.includes('### Skills') ||
            sysText.includes('{{SKILL_LIST}}') ||
            sysText.includes('Call `Skill`');
          yield { type: 'text', content: leaked ? 'skills-leaked-in-prompt' : 'no-skills-prompt-ok' };
          yield { type: 'done' };
          return;
        }
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

  it('forwards ToolExecutionContext.signal to subagent run', async () => {
    const ac = new AbortController();
    const childProbe = '__subagent_parent_signal__';
    const subagentModel: ModelAdapter = {
      name: 'subagent-signal-model',
      async *stream(params: ModelParams) {
        const lastMessage = params.messages[params.messages.length - 1];
        if (
          lastMessage &&
          lastMessage.role === 'user' &&
          typeof lastMessage.content === 'string' &&
          lastMessage.content === childProbe
        ) {
          if (!params.signal) {
            yield { type: 'text', content: 'missing-signal' };
            yield { type: 'done' };
            return;
          }
          if (params.signal !== ac.signal) {
            yield { type: 'text', content: 'wrong-signal' };
            yield { type: 'done' };
            return;
          }
          yield { type: 'text', content: 'subagent-signal-ok' };
          yield { type: 'done' };
          return;
        }
        yield { type: 'text', content: 'unexpected' };
        yield { type: 'done' };
      },
      async complete() {
        return { content: 'ok' };
      }
    };
    const agent = new Agent({
      model: subagentModel,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD
    });

    const r = await agent.getToolRegistry().execute(
      'Agent',
      { prompt: childProbe },
      { signal: ac.signal, projectDir: process.cwd() }
    );

    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('subagent-signal-ok');
  });

  it('excludes AskUserQuestion from built-in general-purpose and explore subagent toolsets', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD
    });
    expect(agent.getToolRegistry().getAll().some((t) => t.name === 'AskUserQuestion')).toBe(true);

    const gp = await agent.getToolRegistry().execute('Agent', {
      prompt: SUBAGENT_PROBE_PROMPT,
      subagent_type: 'general-purpose'
    });
    expect(gp.isError).toBeFalsy();
    expect((gp.metadata?.toolNames as string[] | undefined) ?? []).not.toContain('AskUserQuestion');

    const ex = await agent.getToolRegistry().execute('Agent', {
      prompt: SUBAGENT_PROBE_PROMPT,
      subagent_type: 'explore'
    });
    expect(ex.isError).toBeFalsy();
    expect((ex.metadata?.toolNames as string[] | undefined) ?? []).not.toContain('AskUserQuestion');
  });

  it('includes Skill in subagent toolset for general-purpose and custom profiles', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD
    });
    expect(agent.getToolRegistry().getAll().some((t) => t.name === 'Skill')).toBe(true);

    const gpResult = await agent.getToolRegistry().execute('Agent', {
      prompt: 'child-task'
    });
    expect(gpResult.isError).toBeFalsy();
    const gpNames = gpResult.metadata?.toolNames as string[] | undefined;
    expect(gpNames).toBeDefined();
    expect(gpNames).toContain('Skill');

    const customAgent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      subagent: {
        profiles: [
          {
            name: 'with-skill',
            description: 'lists Skill explicitly',
            tools: ['Read', 'Skill']
          }
        ]
      }
    });

    const customResult = await customAgent.getToolRegistry().execute('Agent', {
      prompt: SUBAGENT_PROBE_PROMPT,
      subagent_type: 'with-skill'
    });
    expect(customResult.isError).toBeFalsy();
    const customNames = customResult.metadata?.toolNames as string[] | undefined;
    expect(customNames?.sort()).toEqual(['Read', 'Skill'].sort());
  });

  it('omits Skills section from subagent default system prompt', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD
    });

    const result = await agent.getToolRegistry().execute('Agent', {
      prompt: SUBAGENT_NO_SKILLS_PROMPT
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('no-skills-prompt-ok');
  });

  it('includes dangerous tools in general-purpose child toolset by default', async () => {
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
    expect(toolNames).toContain('DangerousExec');
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

  it('matches subagent_type case-insensitively', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD
    });

    const result = await agent.getToolRegistry().execute('Agent', {
      prompt: SUBAGENT_PROBE_PROMPT,
      subagent_type: 'Explore'
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('explore-system-ok');
    expect((result.metadata as { subagentType?: string }).subagentType).toBe('explore');
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

  it('explore inherits parent tools minus Write Edit Agent and hides dangerous tools by default', async () => {
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
    expect(toolNames).toContain('Read');
    if (agent.getToolRegistry().has('Skill')) {
      expect(toolNames).toContain('Skill');
    }
    expect(toolNames).not.toContain('Write');
    expect(toolNames).not.toContain('Edit');
    expect(toolNames).not.toContain('Agent');
    expect(toolNames).not.toContain('AskUserQuestion');
    expect(toolNames).not.toContain('Bash');
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

  it('returns error for unknown subagent_type', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD
    });
    await agent.waitForInit();
    const result = await agent.getToolRegistry().execute('Agent', {
      prompt: 'task',
      subagent_type: 'does-not-exist'
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown subagent_type');
  });

  it('includes programmatic subagent profile in Agent tool description', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      subagent: {
        profiles: [
          {
            name: 'audit-bot',
            description: 'Security-focused read-only audits.',
            tools: ['Read', 'Grep']
          }
        ]
      }
    });
    await agent.waitForInit();
    const tool = agent.getToolRegistry().get('Agent');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('**audit-bot**');
    expect(tool!.description).toContain('Security-focused');
  });

  it('uses profile tools when subagent_type matches programmatic profile', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      subagent: {
        profiles: [
          {
            name: 'mini-read',
            description: 'Read only.',
            tools: ['Read']
          }
        ]
      }
    });
    const result = await agent.getToolRegistry().execute('Agent', {
      prompt: SUBAGENT_PROBE_PROMPT,
      subagent_type: 'mini-read'
    });
    expect(result.isError).toBeFalsy();
    const toolNames = (result.metadata as { toolNames?: string[] } | undefined)?.toolNames ?? [];
    expect(toolNames).toEqual(['Read']);
  });

  it('applies disallowedTools even when allowed_tools is passed', async () => {
    const agent = new Agent({
      model: createSubagentTestModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      subagent: {
        profiles: [
          {
            name: 'restricted',
            description: 'disallow read',
            disallowedTools: ['Read']
          }
        ]
      }
    });

    const result = await agent.getToolRegistry().execute('Agent', {
      prompt: SUBAGENT_PROBE_PROMPT,
      subagent_type: 'restricted',
      allowed_tools: ['Read', 'Glob']
    });
    expect(result.isError).toBeFalsy();
    const toolNames = (result.metadata as { toolNames?: string[] } | undefined)?.toolNames ?? [];
    expect(toolNames).toEqual(['Glob']);
  });

  it('succeeds for explore when parent only has non-default custom tools', async () => {
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

    expect(result.isError).toBeFalsy();
    expect((result.metadata?.toolNames as string[] | undefined) ?? []).toEqual(['OnlyCustom']);
  });
});

