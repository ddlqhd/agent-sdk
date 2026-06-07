import { describe, it, expect, afterEach } from 'vitest';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildToolCallStart,
  getToolKind,
  makeAcpToolCallId
} from '../../packages/agent-sdk-acp/src/tool-render.js';
import {
  extractTodosFromToolResult,
  EventBridge
} from '../../packages/agent-sdk-acp/src/event-bridge.js';
import {
  buildEditProposal,
  isPathInsideDirectory,
  shouldAutoApproveEdit
} from '../../packages/agent-sdk-acp/src/edit-approval.js';
import {
  AUTO_APPROVED_TOOLS,
  createPermissionContext,
  needsExplicitApproval
} from '../../packages/agent-sdk-acp/src/permissions.js';
import { resolveAcpUserBase } from '../../packages/agent-sdk-acp/src/user-base.js';
import { mapAcpMcpServers } from '../../packages/agent-sdk-acp/src/mcp-map.js';
import { mapEditModeId } from '../../packages/agent-sdk-acp/src/edit-approval.js';

describe('acp-bridge tool-render', () => {
  it('maps SDK tool names to ACP kinds', () => {
    expect(getToolKind('Read')).toBe('read');
    expect(getToolKind('Grep')).toBe('search');
    expect(getToolKind('Write')).toBe('edit');
    expect(getToolKind('Bash')).toBe('execute');
    expect(getToolKind('mcp__server__search')).toBe('search');
  });

  it('builds tool call start payloads', () => {
    const id = makeAcpToolCallId();
    const start = buildToolCallStart('Read', { file_path: '/tmp/a.txt' }, id);
    expect(start.sessionUpdate).toBe('tool_call');
    expect(start.toolCallId).toBe(id);
    expect(start.title).toContain('Read');
    expect(start.locations?.[0]?.path).toBe('/tmp/a.txt');
  });
});

describe('acp-bridge plan extraction', () => {
  it('reads todos from onToolResult metadata shape', () => {
    const todos = extractTodosFromToolResult({
      todos: [
        { content: 'Step 1', status: 'completed' },
        { content: 'Step 2', status: 'in_progress' }
      ]
    });
    expect(todos).toHaveLength(2);
    expect(todos?.[0].status).toBe('completed');
  });

  it('returns null when metadata has no todos', () => {
    expect(extractTodosFromToolResult({})).toBeNull();
    expect(extractTodosFromToolResult(null)).toBeNull();
  });
});

describe('acp-bridge edit proposals', () => {
  it('builds Write proposal', () => {
    const p = buildEditProposal('Write', { file_path: '/x.ts', content: 'hello' });
    expect(p?.path).toBe('/x.ts');
    expect(p?.newText).toBe('hello');
    expect(p?.oldText).toBeNull();
  });

  it('rejects sibling paths with directory prefix collision', () => {
    const project = resolve('/acp-path-test/proj');
    const sibling = resolve('/acp-path-test/proj-evil/secret.ts');
    const inside = join(project, 'foo.ts');
    expect(isPathInsideDirectory(sibling, project)).toBe(false);
    expect(isPathInsideDirectory(inside, project)).toBe(true);
    expect(shouldAutoApproveEdit(sibling, 'accept_edits', project)).toBe(false);
    expect(shouldAutoApproveEdit(inside, 'accept_edits', project)).toBe(true);
  });
});

describe('acp-bridge permissions policy', () => {
  it('auto-approves read-only builtins', () => {
    expect(AUTO_APPROVED_TOOLS).toContain('Read');
    expect(needsExplicitApproval('Bash')).toBe(true);
    expect(needsExplicitApproval('Read')).toBe(false);
  });
});

describe('resolveAcpUserBase', () => {
  const original = process.env.AGENT_SDK_ACP_USER_BASE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.AGENT_SDK_ACP_USER_BASE;
    } else {
      process.env.AGENT_SDK_ACP_USER_BASE = original;
    }
  });

  it('uses env override when set', () => {
    process.env.AGENT_SDK_ACP_USER_BASE = '/custom/base';
    expect(resolveAcpUserBase()).toBe('/custom/base');
  });

  it('uses stable tmpdir path when env unset', () => {
    delete process.env.AGENT_SDK_ACP_USER_BASE;
    expect(resolveAcpUserBase()).toBe(join(tmpdir(), 'agent-sdk-acp'));
  });
});

describe('setEditMode sync via permissionCtx', () => {
  it('updates editMode on permission context', () => {
    const ctx = createPermissionContext('s1', '/proj', 'default', {} as never);
    const mode = mapEditModeId('accept_edits');
    ctx.editMode = mode;
    expect(ctx.editMode).toBe('accept_edits');
    expect(shouldAutoApproveEdit('/proj/foo.ts', ctx.editMode, '/proj')).toBe(true);
  });
});

describe('mapAcpMcpServers', () => {
  it('maps stdio servers', () => {
    const mapped = mapAcpMcpServers([
      {
        name: 'demo',
        command: 'node',
        args: ['server.js'],
        env: [{ name: 'FOO', value: 'bar' }]
      }
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped?.[0]).toMatchObject({
      name: 'demo',
      transport: 'stdio',
      command: 'node',
      env: { FOO: 'bar' }
    });
  });

  it('maps http servers', () => {
    const mapped = mapAcpMcpServers([
      {
        type: 'http',
        name: 'remote',
        url: 'http://127.0.0.1:8080',
        headers: [{ name: 'Authorization', value: 'Bearer x' }]
      }
    ]);
    expect(mapped?.[0]).toMatchObject({
      transport: 'http',
      url: 'http://127.0.0.1:8080',
      headers: { Authorization: 'Bearer x' }
    });
  });

  it('skips unsupported sse transport', () => {
    const mapped = mapAcpMcpServers([
      {
        type: 'sse',
        name: 'sse-srv',
        url: 'http://127.0.0.1:9090',
        headers: []
      }
    ]);
    expect(mapped).toBeUndefined();
  });
});

describe('EventBridge', () => {
  it('resetTurn clears announced tool state', () => {
    const sent: unknown[] = [];
    const fakeConn = {
      sessionUpdate: async (n: unknown) => {
        sent.push(n);
      }
    } as never;
    const bridge = new EventBridge(fakeConn, 'sess-1');
    bridge.resetTurn();
    expect(sent).toHaveLength(0);
  });

  it('resetTurn clears tool call id mappings', async () => {
    const sent: unknown[] = [];
    const fakeConn = {
      sessionUpdate: async (update: unknown) => {
        sent.push(update);
      }
    } as never;
    const bridge = new EventBridge(fakeConn, 'sess-1');
    await bridge.handleStreamEvent({ type: 'tool_call_start', id: 'sdk-1', name: 'Read' });
    bridge.resetTurn();
    const countAfterStart = sent.length;
    await bridge.handleStreamEvent({
      type: 'tool_result',
      toolCallId: 'sdk-1',
      result: 'ok'
    });
    expect(sent.length).toBe(countAfterStart);
  });
});
