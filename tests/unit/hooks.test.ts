import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry, createTool } from '../../src/tools/registry.js';
import { HookManager, createFunctionHook, matchTool, mergeCommandHookLayers, parseHooksSettingsFile } from '../../src/tools/hooks/index.js';
import { z } from 'zod';

describe('matchTool', () => {
  it('matches regex', () => {
    expect(matchTool('Write', 'Write|Edit')).toBe(true);
    expect(matchTool('Edit', 'Write|Edit')).toBe(true);
    expect(matchTool('Read', 'Write|Edit')).toBe(false);
  });

  it('treats empty or * as match all', () => {
    expect(matchTool('Anything', undefined)).toBe(true);
    expect(matchTool('Anything', '*')).toBe(true);
  });

  it('returns false on invalid regex', () => {
    expect(matchTool('x', '(')).toBe(false);
  });
});

describe('mergeCommandHookLayers', () => {
  it('orders no-id project then user', () => {
    const merged = mergeCommandHookLayers(
      [
        {
          matcher: 'A',
          hooks: [{ type: 'command', command: 'p1' }]
        }
      ],
      [
        {
          matcher: 'A',
          hooks: [{ type: 'command', command: 'u1' }]
        }
      ]
    );
    expect(merged.map(e => e.hook.command)).toEqual(['p1', 'u1']);
  });

  it('replaces same id from user', () => {
    const merged = mergeCommandHookLayers(
      [
        {
          hooks: [
            { id: 'x', type: 'command', command: 'proj' }
          ]
        }
      ],
      [
        {
          hooks: [
            { id: 'x', type: 'command', command: 'user' }
          ]
        }
      ]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].hook.command).toBe('user');
  });
});

describe('parseHooksSettingsFile', () => {
  it('maps PascalCase keys to runtime HookEventType', () => {
    const s = parseHooksSettingsFile({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo pre' }]
          }
        ],
        PostToolUse: [
          {
            hooks: [{ type: 'command', command: 'echo post' }]
          }
        ]
      }
    });
    expect(s.hooks.preToolUse).toHaveLength(1);
    expect(s.hooks.preToolUse[0].hooks[0].command).toBe('echo pre');
    expect(s.hooks.postToolUse).toHaveLength(1);
  });
});

describe('ToolRegistry + HookManager', () => {
  it('blocks tool when pre hook denies', async () => {
    const registry = new ToolRegistry();
    const hm = HookManager.create();
    hm.register(
      createFunctionHook({
        id: 'block',
        event: 'preToolUse',
        matcher: 'add',
        handler: async () => ({ allowed: false, reason: 'no' })
      })
    );
    registry.setHookManager(hm);

    const tool = createTool({
      name: 'add',
      description: 'add',
      parameters: z.object({ a: z.number() }),
      handler: async () => ({ content: 'ok' })
    });
    registry.register(tool);

    const r = await registry.execute('add', { a: 1 });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('no');
  });

  it('merges updatedInput from function pre hook', async () => {
    const registry = new ToolRegistry();
    const hm = HookManager.create();
    hm.register(
      createFunctionHook({
        id: 'patch',
        event: 'preToolUse',
        matcher: 'add',
        handler: async () => ({
          allowed: true,
          updatedInput: { a: 10 }
        })
      })
    );
    registry.setHookManager(hm);

    const spy = vi.fn(async ({ a }: { a: number }) => ({ content: String(a) }));
    const tool = createTool({
      name: 'add',
      description: 'add',
      parameters: z.object({ a: z.number() }),
      handler: spy
    });
    registry.register(tool);

    await registry.execute('add', { a: 1 });
    expect(spy).toHaveBeenCalledWith(
      { a: 10 },
      expect.objectContaining({
        toolCallId: undefined,
        projectDir: undefined
      })
    );
  });

  it('runs hooks for Agent tool', async () => {
    const registry = new ToolRegistry();
    const hm = HookManager.create();
    const preSpy = vi.fn(async () => ({ allowed: true }));
    const postSpy = vi.fn(async () => ({ continue: true }));
    hm.register(
      createFunctionHook({
        id: 'agent-pre',
        event: 'preToolUse',
        matcher: 'Agent',
        handler: preSpy
      })
    );
    hm.register(
      createFunctionHook({
        id: 'agent-post',
        event: 'postToolUse',
        matcher: 'Agent',
        handler: postSpy
      })
    );
    registry.setHookManager(hm);

    const tool = createTool({
      name: 'Agent',
      description: 'delegate',
      parameters: z.object({ prompt: z.string() }),
      handler: async ({ prompt }) => ({ content: `ok:${prompt}` })
    });
    registry.register(tool);

    const result = await registry.execute('Agent', { prompt: 'hello' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('ok:hello');
    expect(preSpy).toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalled();
  });
});
