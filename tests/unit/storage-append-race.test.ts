import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionManager } from '../../src/storage/session.js';
import { JsonlStorage } from '../../src/storage/jsonl.js';

describe('concurrent SessionManager.appendEntries (jsonl)', () => {
  let basePath: string;
  let storage: JsonlStorage;

  beforeEach(async () => {
    basePath = await fs.mkdtemp(join(tmpdir(), 'append-race-'));
    storage = new JsonlStorage({ basePath });
  });

  afterEach(async () => {
    await storage.clear().catch(() => {});
    await fs.rm(basePath, { recursive: true, force: true }).catch(() => {});
  });

  it('parallel appends preserve all lines', async () => {
    const sid = 'race-sess';
    await storage.append(sid, [{ role: 'user', content: 'seed' }]);

    const mk = (label: string) => {
      const sm = new SessionManager({ type: 'jsonl', basePath: basePath });
      return sm;
    };

    const a = mk('a');
    const b = mk('b');
    await Promise.all([
      (async () => {
        await a.attachSession(sid);
        await a.appendEntries([{ role: 'user', content: 'p1' }]);
      })(),
      (async () => {
        await b.attachSession(sid);
        await b.appendEntries([{ role: 'user', content: 'p2' }]);
      })()
    ]);

    const lines = await storage.load(sid);
    const users = lines.filter((e) => (e as { role?: string }).role === 'user');
    expect(users.length).toBeGreaterThanOrEqual(3);
    const contents = users.map((u) => (u as { content: string }).content);
    expect(contents).toContain('seed');
    expect(contents.some((c) => c === 'p1' || c === 'p2')).toBe(true);
  });
});
