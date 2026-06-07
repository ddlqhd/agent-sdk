import { describe, it, expect, vi } from 'vitest';
import { collectSessionStatus } from '../../src/cli/utils/session-status.js';
import type { Agent } from '../../src/core/agent.js';

function makeAgent(overrides: Partial<{
  sessionId: string | undefined;
  loadFails: boolean;
  messages: Array<{ role: string; content: string }>;
  checkpoints: number;
  activeCount: number;
}>): Agent {
  const sessionId = 'sessionId' in overrides ? overrides.sessionId : 'sess-abc';
  const loadFails = overrides.loadFails ?? false;
  const messages = overrides.messages ?? [
    { role: 'user', content: 'hello world' },
    { role: 'assistant', content: 'hi there' }
  ];
  const checkpoints = overrides.checkpoints ?? 2;
  const activeCount = overrides.activeCount ?? 5;

  return {
    getSessionManager: () => ({
      sessionId,
      attachSession: vi.fn(async () => {}),
      loadActiveMessages: loadFails
        ? vi.fn(async () => {
            throw new Error('load failed');
          })
        : vi.fn(async () => messages)
    }),
    getModel: () => ({ name: 'test-model' }),
    listSessionCheckpoints: vi.fn(async () =>
      Array.from({ length: checkpoints }, (_, i) => ({
        checkpointId: `c${i}`,
        userTurnIndex: i,
        preview: 'p'
      }))
    ),
    getSessionUsage: () => ({
      contextTokens: 100,
      inputTokens: 200,
      outputTokens: 80,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 280
    }),
    getContextStatus: () => ({
      used: 100,
      usable: 900,
      needsCompaction: false,
      compressCount: 0
    }),
    getActiveMessageCount: () => activeCount
  } as unknown as Agent;
}

describe('collectSessionStatus', () => {
  it('collects session fields when attach succeeds', async () => {
    const agent = makeAgent({});
    const snap = await collectSessionStatus(agent, {
      sessionId: 'sess-abc',
      verbose: true,
      streaming: false,
      cwd: '/tmp'
    });

    expect(snap.modelName).toBe('test-model');
    expect(snap.activeMessageCount).toBe(2);
    expect(snap.checkpointCount).toBe(2);
    expect(snap.lastUserPreview).toBe('hello world');
    expect(snap.lastAssistantPreview).toBe('hi there');
    expect(snap.verbose).toBe(true);
    expect(snap.usage.inputTokens).toBe(200);
  });

  it('falls back to getActiveMessageCount when load fails', async () => {
    const agent = makeAgent({ loadFails: true, activeCount: 7 });
    const snap = await collectSessionStatus(agent, {
      sessionId: 'sess-abc',
      verbose: false,
      streaming: false,
      cwd: '/work'
    });

    expect(snap.activeMessageCount).toBe(7);
    expect(snap.checkpointCount).toBe(0);
  });

  it('handles no session id', async () => {
    const agent = makeAgent({});
    const snap = await collectSessionStatus(agent, {
      sessionId: undefined,
      verbose: false,
      streaming: false,
      cwd: '/work'
    });

    expect(snap.sessionId).toBe('sess-abc');
    expect(snap.activeMessageCount).toBe(2);
  });

  it('returns zero counts when manager has no session', async () => {
    const agent = makeAgent({ sessionId: undefined });
    const snap = await collectSessionStatus(agent, {
      sessionId: undefined,
      verbose: false,
      streaming: false,
      cwd: '/work'
    });

    expect(snap.sessionId).toBeUndefined();
    expect(snap.activeMessageCount).toBe(0);
  });
});
