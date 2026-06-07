import { describe, it, expect, vi } from 'vitest';
import { resolveSlashCommandName, matchSlashCommandsByPrefix } from '../../src/cli/utils/slash-registry.js';
import {
  handleSlashCommand,
  resolvePickerSelection,
  type SlashContext
} from '../../src/cli/utils/slash-commands.js';
import type { Agent } from '../../src/core/agent.js';
import type { SessionPickerItem } from '../../src/cli/utils/session-cli.js';

function mockAgent(overrides: Partial<{
  sessionId: string | undefined;
  checkpoints: unknown[];
  rewindResult: { keptMessageCount: number; droppedMessageCount: number };
  forkResult: { sourceSessionId: string; sessionId: string; messageCount: number };
  contextStatus: null | object;
}> = {}): Agent {
  const sm = {
    sessionId: overrides.sessionId,
    loadActiveMessages: vi.fn(async () => []),
    createSession: vi.fn(() => 'new-sess-id'),
    attachSession: vi.fn(async () => {})
  };
  return {
    getSessionManager: () => sm,
    getModel: () => ({ name: 'test-model' }),
    getActiveMessageCount: () => 0,
    getSessionUsage: () => ({ inputTokens: 1, outputTokens: 2, outputTokensDetails: {}, totalTokens: 3 }),
    getContextStatus: () => overrides.contextStatus ?? null,
    listSessionCheckpoints: vi.fn(async () => overrides.checkpoints ?? []),
    rewindToCheckpoint: vi.fn(async () =>
      overrides.rewindResult ?? { keptMessageCount: 1, droppedMessageCount: 2 }
    ),
    forkSession: vi.fn(async () =>
      overrides.forkResult ?? {
        sourceSessionId: 'src',
        sessionId: 'forked',
        messageCount: 3
      }
    ),
    clearMessages: vi.fn(),
    compressContext: vi.fn(async () => ({
      messageCount: 1,
      stats: { originalMessageCount: 5, compressedMessageCount: 2, durationMs: 10 }
    })),
    getToolRegistry: () => ({ getAll: () => [] })
  } as unknown as Agent;
}

function baseCtx(overrides: Partial<SlashContext> = {}): SlashContext {
  return {
    sessionId: 'sess-1',
    verbose: false,
    cwd: process.cwd(),
    askLine: async () => '',
    onReplay: async () => {},
    ...overrides
  };
}

describe('slash-registry', () => {
  it('resolves aliases', () => {
    expect(resolveSlashCommandName('clear')).toBe('new');
    expect(resolveSlashCommandName('q')).toBe('exit');
  });

  it('matches prefix for suggestions', () => {
    const m = matchSlashCommandsByPrefix('che');
    expect(m.some((c) => c.name === 'checkpoints')).toBe(true);
  });
});

describe('handleSlashCommand', () => {
  it('/help is handled', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await handleSlashCommand(mockAgent(), '/help', baseCtx());
    expect(r).toEqual({ handled: true, sessionId: 'sess-1' });
    logSpy.mockRestore();
  });

  it('/details toggles verbose', async () => {
    const r = await handleSlashCommand(mockAgent(), '/details', baseCtx({ verbose: false }));
    expect(r).toMatchObject({ handled: true, verbose: true });
  });

  it('/rewind sets replayHistory', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const agent = mockAgent();
    const r = await handleSlashCommand(agent, '/rewind 0', baseCtx());
    expect(r).toMatchObject({ handled: true, replayHistory: true });
    expect(agent.rewindToCheckpoint).toHaveBeenCalledWith({ userTurnIndex: 0 });
    logSpy.mockRestore();
  });

  it('/fork with turn index', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const agent = mockAgent();
    const r = await handleSlashCommand(agent, '/fork 2', baseCtx());
    expect(r).toMatchObject({ handled: true, sessionId: 'forked', replayHistory: true });
    expect(agent.forkSession).toHaveBeenCalledWith('sess-1', {
      switchToForked: true,
      userTurnIndex: 2
    });
    logSpy.mockRestore();
  });

  it('unknown slash returns handled false', async () => {
    const r = await handleSlashCommand(mockAgent(), '/not-a-builtin-cmd', baseCtx());
    expect(r).toEqual({ handled: false });
  });

  it('/exit sets exit flag', async () => {
    const r = await handleSlashCommand(mockAgent(), '/exit', baseCtx());
    expect(r).toMatchObject({ handled: true, exit: true });
  });
});

describe('resolvePickerSelection', () => {
  const items: SessionPickerItem[] = [
    { id: 'aaaa-bbbb', messageCount: 1, updatedAt: 1, preview: 'hello world' },
    { id: 'cccc-dddd', messageCount: 2, updatedAt: 2, preview: 'other' }
  ];

  it('selects by number', () => {
    expect(resolvePickerSelection(items, '2')?.id).toBe('cccc-dddd');
  });

  it('selects by id prefix', () => {
    expect(resolvePickerSelection(items, 'aaaa')?.id).toBe('aaaa-bbbb');
  });
});
