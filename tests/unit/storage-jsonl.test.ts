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

  it('saveSystemPrompt writes sidecar', async () => {
    const sid = 'sess-sys';
    await storage.append(sid, [{ role: 'user', content: 'x' }]);
    await storage.saveSystemPrompt?.(sid, 'hello system', { cwd: '/tmp', agentName: 'T' });
    const p = join(basePath, `${sid}.system.json`);
    const side = JSON.parse(await fs.readFile(p, 'utf-8'));
    expect(side.content).toBe('hello system');
    expect(side.cwd).toBe('/tmp');
    expect(side.agentName).toBe('T');
    expect(typeof side.contentSha256).toBe('string');
  });
});
