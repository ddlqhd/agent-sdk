import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { JsonlStorage } from '../../src/storage/jsonl.js';
import { SessionManager, reconstructActiveMessages, buildSummaryEntry } from '../../src/storage/session.js';
import type { CompressionStats, Message, SummaryEntry } from '../../src/core/types.js';
import { formatSyntheticUserSummary } from '../../src/core/compressor.js';

const stats: CompressionStats = {
  originalMessageCount: 10,
  compressedMessageCount: 3,
  durationMs: 1
};

describe('JsonlStorage append-only + logical truncation', () => {
  let basePath: string;
  let storage: JsonlStorage;

  beforeEach(async () => {
    basePath = await fs.mkdtemp(join(tmpdir(), 'jsonl-stor-'));
    storage = new JsonlStorage({ basePath });
  });

  afterEach(async () => {
    await storage.clear().catch(() => {});
    await fs.rm(basePath, { recursive: true, force: true }).catch(() => {});
  });

  it('append extends file; load returns all raw lines', async () => {
    const sid = 'sess-a';
    await storage.append(sid, [{ role: 'user', content: 'u1' }]);
    await storage.append(sid, [{ role: 'assistant', content: 'a1' }]);
    const raw = await storage.load(sid);
    expect(raw).toHaveLength(2);
    expect(raw[0]).toMatchObject({ role: 'user', content: 'u1' });
    const path = join(basePath, `${sid}.jsonl`);
    expect((await fs.readFile(path, 'utf-8')).trimEnd().split('\n').filter(Boolean).length).toBe(
      2
    );
  });

  it('second compaction appends; active chain starts at last summary only', async () => {
    const sid = 'sess-b';
    await storage.append(sid, [{ role: 'user', content: 'old' }]);
    const s1: SummaryEntry = {
      $type: 'summary',
      summaryMode: 'llm',
      text: 'sum1',
      stats,
      timestamp: 1
    };
    await storage.append(sid, [s1, { role: 'user', content: 'recent1' }]);

    const s2: SummaryEntry = {
      $type: 'summary',
      summaryMode: 'llm',
      text: 'sum2',
      stats,
      timestamp: 2
    };
    await storage.append(sid, [s2, { role: 'assistant', content: 'tail' }]);

    const raw = await storage.load(sid);
    expect(raw.length).toBeGreaterThan(3);

    const active = reconstructActiveMessages(raw);
    expect(active).toHaveLength(2);
    expect(active[0]).toMatchObject({
      role: 'user',
      content: formatSyntheticUserSummary('sum2')
    });
    expect(active[1]).toMatchObject({ role: 'assistant', content: 'tail' });
  });

  it('SessionManager appendCompactionBoundary + loadActiveMessages', async () => {
    const sm = new SessionManager({ type: 'jsonl', basePath });
    sm.createSession('sess-c');
    await sm.appendEntries([
      { role: 'user', content: 'gone' },
      { role: 'assistant', content: 'gone-a' }
    ]);

    const summaryMsg: Message = {
      role: 'user',
      content: formatSyntheticUserSummary('compressed-body')
    };
    const summaryEntry = buildSummaryEntry(summaryMsg, stats);
    const recent: Message[] = [{ role: 'user', content: 'keep-u' }];
    await sm.appendCompactionBoundary(summaryEntry, recent);

    const active = await sm.loadActiveMessages();
    expect(active).toHaveLength(2);
    expect(active[0]).toMatchObject({ role: 'user', content: summaryMsg.content });
    expect(active[1]).toMatchObject({ role: 'user', content: 'keep-u' });
  });

  it('updateSessionMeta writes cwd/agentName; append preserves them', async () => {
    const sid = 'sess-sys';
    await storage.updateSessionMeta(sid, { cwd: '/tmp', agentName: 'T' });
    await storage.append(sid, [{ role: 'user', content: 'x' }]);
    const listed = await storage.list();
    const info = listed.find((s) => s.id === sid);
    expect(info?.cwd).toBe('/tmp');
    expect(info?.agentName).toBe('T');
    expect(info?.messageCount).toBe(1);
    await expect(fs.access(join(basePath, `${sid}.system.json`))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('lists meta-only sessions; exists still requires jsonl', async () => {
    const sid = 'meta-only';
    await storage.updateSessionMeta(sid, { cwd: '/work', agentName: 'A' });
    const listed = await storage.list();
    expect(listed.find((s) => s.id === sid)).toMatchObject({
      id: sid,
      messageCount: 0,
      cwd: '/work',
      agentName: 'A'
    });
    expect(await storage.exists(sid)).toBe(false);
  });

  it('updateSessionMeta after append does not reset messageCount', async () => {
    const sid = 'keep-count';
    await storage.append(sid, [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' }
    ]);
    await storage.updateSessionMeta(sid, { cwd: '/keep', agentName: 'Keep' });
    const info = (await storage.list()).find((s) => s.id === sid);
    expect(info?.messageCount).toBe(2);
    expect(info?.cwd).toBe('/keep');
    expect(info?.agentName).toBe('Keep');
  });

  it('partial updateSessionMeta keeps the other field', async () => {
    const sid = 'partial-meta';
    await storage.updateSessionMeta(sid, { cwd: '/a', agentName: 'Name' });
    await storage.updateSessionMeta(sid, { cwd: '/b' });
    const info = (await storage.list()).find((s) => s.id === sid);
    expect(info?.cwd).toBe('/b');
    expect(info?.agentName).toBe('Name');
  });
});
