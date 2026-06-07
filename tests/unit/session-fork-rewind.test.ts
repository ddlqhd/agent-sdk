import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { JsonlStorage } from '../../src/storage/jsonl.js';
import { MemoryStorage } from '../../src/storage/memory.js';
import {
  SessionManager,
  reconstructActiveMessages,
  reconstructPrefixMessages,
  buildRewindEntry,
  buildSummaryEntry,
  listSessionCheckpointsFromRaw,
  encodeCheckpointId,
  decodeCheckpointId
} from '../../src/storage/session.js';
import { formatSyntheticUserSummary } from '../../src/core/compressor.js';
import type { CompressionStats, Message, SummaryEntry } from '../../src/core/types.js';
import { createAgent } from '../../src/core/agent.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';

const stats: CompressionStats = {
  originalMessageCount: 10,
  compressedMessageCount: 3,
  durationMs: 1
};

function mockModel(): ModelAdapter {
  return {
    name: 'mock',
    provider: 'openai',
    async *stream(_params: ModelParams): AsyncIterable<StreamChunk> {
      yield { type: 'text_delta', content: 'ok' };
      yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
    },
    async complete() {
      return { content: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
    }
  };
}

describe('RewindEntry parse and reconstruct', () => {
  let basePath: string;
  let storage: JsonlStorage;

  beforeEach(async () => {
    basePath = await fs.mkdtemp(join(tmpdir(), 'fork-rewind-'));
    storage = new JsonlStorage({ basePath });
  });

  afterEach(async () => {
    await storage.clear().catch(() => {});
    await fs.rm(basePath, { recursive: true, force: true }).catch(() => {});
  });

  it('parseLine roundtrip for RewindEntry', async () => {
    const sid = 'rewind-parse';
    await storage.append(sid, [{ role: 'user', content: 'u1' }]);
    await storage.append(sid, [buildRewindEntry(0)]);
    const raw = await storage.load(sid);
    expect(raw).toHaveLength(2);
    expect((raw[1] as { $type: string }).$type).toBe('rewind');
    expect((raw[1] as { keepThroughRawIndex: number }).keepThroughRawIndex).toBe(0);
  });

  it('rewind to user drops same-turn assistant and tail', async () => {
    const entries = [
      { role: 'user' as const, content: 'u1' },
      { role: 'assistant' as const, content: 'a1' },
      { role: 'user' as const, content: 'u2' },
      { role: 'assistant' as const, content: 'a2' },
      { role: 'tool' as const, content: 't1', toolCallId: '1' },
      buildRewindEntry(2)
    ];
    const active = reconstructActiveMessages(entries);
    expect(active.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(active[2]).toMatchObject({ content: 'u2' });
  });

  it('prefix + tail after rewind', async () => {
    const entries = [
      { role: 'user' as const, content: 'u1' },
      { role: 'assistant' as const, content: 'a1' },
      { role: 'user' as const, content: 'u2' },
      { role: 'assistant' as const, content: 'a2' },
      buildRewindEntry(2),
      { role: 'user' as const, content: 'u3' },
      { role: 'assistant' as const, content: 'a3' }
    ];
    const active = reconstructActiveMessages(entries);
    expect(active.map((m) => m.content)).toEqual(['u1', 'a1', 'u2', 'u3', 'a3']);
  });

  it('rewind to pre-compaction user excludes summary', async () => {
    const s1: SummaryEntry = {
      $type: 'summary',
      summaryMode: 'llm',
      text: 'sum',
      stats,
      timestamp: 1
    };
    const entries = [
      { role: 'user' as const, content: 'old' },
      { role: 'assistant' as const, content: 'old-a' },
      s1,
      { role: 'user' as const, content: 'recent' },
      buildRewindEntry(0)
    ];
    const active = reconstructActiveMessages(entries);
    expect(active).toEqual([{ role: 'user', content: 'old' }]);
  });

  it('tail compress after rewind applies summary in tail slice', async () => {
    const summaryMsg: Message = {
      role: 'user',
      content: formatSyntheticUserSummary('tail-sum')
    };
    const summaryEntry = buildSummaryEntry(summaryMsg, stats);
    const entries = [
      { role: 'user' as const, content: 'u1' },
      buildRewindEntry(0),
      { role: 'user' as const, content: 'u2' },
      { role: 'assistant' as const, content: 'a2' },
      summaryEntry,
      { role: 'user' as const, content: 'keep' }
    ];
    const active = reconstructActiveMessages(entries);
    expect(active[0]).toMatchObject({ role: 'user', content: 'u1' });
    expect(active[1]).toMatchObject({ role: 'user', content: summaryMsg.content });
    expect(active[2]).toMatchObject({ role: 'user', content: 'keep' });
  });

  it('checkpointId encodes sessionId and rejects mismatch', () => {
    const id = encodeCheckpointId('sess-a', 3);
    expect(decodeCheckpointId(id, 'sess-a')).toBe(3);
    expect(() => decodeCheckpointId(id, 'other')).toThrow(/session mismatch/);
  });

  it('listSessionCheckpoints summariesAfter', () => {
    const s1: SummaryEntry = {
      $type: 'summary',
      summaryMode: 'llm',
      text: 's1',
      stats,
      timestamp: 1
    };
    const s2: SummaryEntry = {
      $type: 'summary',
      summaryMode: 'llm',
      text: 's2',
      stats,
      timestamp: 2
    };
    const entries = [
      { role: 'user' as const, content: 'u1' },
      { role: 'user' as const, content: 'u2' },
      s1,
      { role: 'user' as const, content: 'u3' },
      s2,
      { role: 'user' as const, content: 'u4' }
    ];
    const cps = listSessionCheckpointsFromRaw('sid', entries);
    expect(cps).toHaveLength(4);
    expect(cps[0].summariesAfter).toBe(2);
    expect(cps[1].summariesAfter).toBe(2);
    expect(cps[2].summariesAfter).toBe(1);
    expect(cps[3].summariesAfter).toBeUndefined();
  });
});

describe('SessionManager fork and rewind', () => {
  let sm: SessionManager;

  beforeEach(() => {
    sm = new SessionManager({ type: 'memory' });
  });

  it('rewindSession droppedMessageCount and idempotent rewind', async () => {
    sm.createSession('r1');
    await sm.appendEntries([
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' }
    ]);
    const first = await sm.rewindSession(2);
    expect(first.droppedMessageCount).toBe(1);
    expect(first.keptMessageCount).toBe(3);
    const second = await sm.rewindToCheckpoint({ userTurnIndex: 1 });
    expect(second.droppedMessageCount).toBe(0);
  });

  it('forkSession does not change attach without switchToForked', async () => {
    sm.createSession('source');
    await sm.appendEntries([{ role: 'user', content: 'hi' }]);
    expect(sm.sessionId).toBe('source');
    const forked = await sm.forkSession('source');
    expect(sm.sessionId).toBe('source');
    expect(forked.sessionId).not.toBe('source');
    const mem = sm.getStorage() as MemoryStorage;
    const forkActive = reconstructActiveMessages(mem.export()[forked.sessionId] ?? []);
    expect(forkActive).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('forkSession rejects missing source and existing newId', async () => {
    sm.createSession('exists');
    await sm.appendEntries([{ role: 'user', content: 'x' }]);
    await expect(sm.forkSession('missing')).rejects.toThrow(/not found/);
    await expect(sm.forkSession('exists', { newSessionId: 'exists' })).rejects.toThrow(
      /already exists/
    );
  });

  it('fork from checkpoint prefix only', async () => {
    sm.createSession('src');
    await sm.appendEntries([
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' }
    ]);
    const forked = await sm.forkSession('src', { userTurnIndex: 0 });
    const mem = sm.getStorage() as MemoryStorage;
    const rows = mem.export()[forked.sessionId] ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'user', content: 'u1' });
  });

  it('copy system sidecar on fork (memory)', async () => {
    sm.createSession('with-sidecar');
    await sm.appendEntries([{ role: 'user', content: 'x' }]);
    await sm.saveSystemPrompt('sys body', { agentName: 'T', cwd: '/tmp' });
    const forked = await sm.forkSession('with-sidecar');
    const mem = sm.getStorage() as MemoryStorage;
    const side = mem.getSystemPromptSidecar(forked.sessionId);
    expect(side?.content).toBe('sys body');
  });
});

describe('Agent fork/rewind integration', () => {
  it('rewind syncs memory and does not double-persist on stream', async () => {
    const agent = createAgent({
      model: mockModel(),
      storage: { type: 'memory' },
      memory: false,
      contextManagement: { enabled: true, contextLength: 128_000 }
    });
    await agent.waitForInit();
    const sm = agent.getSessionManager();
    sm.createSession('agent-r');
    await sm.appendEntries([
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' }
    ]);
    await sm.attachSession('agent-r');
    await agent.rewindToCheckpoint({ userTurnIndex: 1 });
    expect(agent.getActiveMessageCount()).toBe(3);
    const appendSpy = vi.spyOn(sm, 'appendEntries');
    for await (const _ of agent.stream('next')) {
      // drain
    }
    const appended = appendSpy.mock.calls.flatMap((c) => c[0]);
    const replayed = appended.filter(
      (e) =>
        (e as Message).role === 'user' &&
        ((e as Message).content === 'u1' || (e as Message).content === 'u2')
    );
    expect(replayed).toHaveLength(0);
    appendSpy.mockRestore();
  });

  it('stream forkSession uses new id not source', async () => {
    const forkedIds: string[] = [];
    const agent = createAgent({
      model: mockModel(),
      storage: { type: 'memory' },
      memory: false,
      callbacks: {
        lifecycle: {
          onSessionFork: ({ sessionId }) => {
            forkedIds.push(sessionId);
          },
          onSessionResume: () => {
            throw new Error('should not resume source on fork');
          }
        }
      }
    });
    await agent.waitForInit();
    agent.getSessionManager().createSession('source-stream');
    await agent.getSessionManager().appendEntries([{ role: 'user', content: 'seed' }]);
    for await (const event of agent.stream('hello', {
      sessionId: 'source-stream',
      forkSession: true
    })) {
      if (event.type === 'end') {
        break;
      }
    }
    expect(forkedIds).toHaveLength(1);
    expect(forkedIds[0]).not.toBe('source-stream');
    expect(agent.getSessionManager().sessionId).toBe(forkedIds[0]);
  });
});

describe('reconstructPrefixMessages', () => {
  it('walks summary boundaries within prefix', () => {
    const s: SummaryEntry = {
      $type: 'summary',
      summaryMode: 'llm',
      text: 'x',
      stats,
      timestamp: 1
    };
    const entries = [
      { role: 'user' as const, content: 'gone' },
      s,
      { role: 'user' as const, content: 'kept' }
    ];
    const prefix = reconstructPrefixMessages(entries, 2);
    expect(prefix).toHaveLength(2);
    expect(prefix[1]).toMatchObject({ role: 'user', content: 'kept' });
  });
});
