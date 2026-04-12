import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry, createTool } from '../../src/tools/registry.js';
import { Agent } from '../../src/core/agent.js';
import {
  HookManager,
  createFunctionHook,
  matchTool,
  matchesHookIfClause,
  mergeCommandHookLayers,
  parseHooksSettingsFile,
  parsePreToolUseCommandOutput
} from '../../src/tools/hooks/index.js';
import { z } from 'zod';

describe('matchTool', () => {
  it('matches exact tool names or pipe-separated alternates', () => {
    expect(matchTool('Write', 'Write|Edit')).toBe(true);
    expect(matchTool('Edit', 'Write|Edit')).toBe(true);
    expect(matchTool('Read', 'Write|Edit')).toBe(false);
  });

  it('does not match substring for simple identifiers', () => {
    expect(matchTool('Bash', 'Bash')).toBe(true);
    expect(matchTool('XBash', 'Bash')).toBe(false);
  });

  it('matches exact names with hyphen in simple matcher', () => {
    expect(matchTool('Read-File', 'Read-File|Write')).toBe(true);
    expect(matchTool('Write', 'Read-File|Write')).toBe(true);
    expect(matchTool('Read', 'Read-File|Write')).toBe(false);
  });

  it('treats empty or * as match all', () => {
    expect(matchTool('Anything', undefined)).toBe(true);
    expect(matchTool('Anything', '*')).toBe(true);
  });

  it('uses regex when matcher contains metacharacters', () => {
    expect(matchTool('mcp__mem__x', 'mcp__.*')).toBe(true);
    expect(matchTool('Read', 'mcp__.*')).toBe(false);
  });

  it('returns false on invalid regex', () => {
    expect(matchTool('x', '(')).toBe(false);
  });
});

describe('matchesHookIfClause', () => {
  it('matches ToolName(glob) against command', () => {
    expect(matchesHookIfClause('Bash', { command: 'rm -rf /tmp' }, 'Bash(rm *)')).toBe(true);
    expect(matchesHookIfClause('Bash', { command: 'npm test' }, 'Bash(rm *)')).toBe(false);
  });

  it('matches file_path when command absent', () => {
    expect(matchesHookIfClause('Write', { file_path: '/src/foo.ts' }, 'Write(*.ts)')).toBe(true);
  });

  it('allows hyphen in ToolName for if clause', () => {
    expect(
      matchesHookIfClause('My-Tool', { command: 'x' }, 'My-Tool(*)')
    ).toBe(true);
    expect(matchesHookIfClause('Other', { command: 'x' }, 'My-Tool(*)')).toBe(false);
  });
});

describe('parsePreToolUseCommandOutput', () => {
  it('parses hookSpecificOutput deny', () => {
    const r = parsePreToolUseCommandOutput(
      JSON.stringify({
        hookSpecificOutput: {
          permissionDecision: 'deny',
          permissionDecisionReason: 'blocked'
        }
      })
    );
    expect(r).toEqual({ allowed: false, reason: 'blocked' });
  });

  it('parses allow with updatedInput', () => {
    const r = parsePreToolUseCommandOutput(
      JSON.stringify({
        hookSpecificOutput: {
          permissionDecision: 'allow',
          updatedInput: { a: 2 }
        }
      })
    );
    expect(r).toEqual({ allowed: true, updatedInput: { a: 2 } });
  });

  it('parses JSON on last line when prior lines are logs', () => {
    const payload = JSON.stringify({
      hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'nope' }
    });
    const r = parsePreToolUseCommandOutput(`[hook] checking...\n${payload}`);
    expect(r).toEqual({ allowed: false, reason: 'nope' });
  });

  it('skips trailing non-decision JSON and uses earlier line with decision', () => {
    const noise = JSON.stringify({ debug: true });
    const decision = JSON.stringify({
      hookSpecificOutput: { permissionDecision: 'allow' }
    });
    const r = parsePreToolUseCommandOutput(`${decision}\n${noise}`);
    expect(r).toEqual({ allowed: true });
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

  it('passes through if on command hooks', () => {
    const s = parseHooksSettingsFile({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'true', if: 'Bash(git *)' }]
          }
        ]
      }
    });
    expect(s.hooks.preToolUse[0].hooks[0].if).toBe('Bash(git *)');
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

describe('Agent hook file loading', () => {
  it('does not attach HookManager when loadHookSettingsFromFiles is false without hookConfigDir', () => {
    const agent = new Agent({
      modelConfig: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'test-hook-load-off' },
      loadHookSettingsFromFiles: false
    });
    expect(agent.getToolRegistry().getHookManager()).toBeNull();
  });
});
