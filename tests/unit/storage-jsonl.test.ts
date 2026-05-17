import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { JsonlStorage } from '../../src/storage/jsonl.js';
import type { Message } from '../../src/core/types.js';

function jsonlPaths(base: string, sessionId: string): { jsonl: string; meta: string } {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return { jsonl: join(base, `${safe}.jsonl`), meta: join(base, `${safe}.meta.json`) };
}

describe('JsonlStorage', () => {
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

  it('append fast path: extends file by one line when prefix matches', async () => {
    const sid = 'sess-append';
    const m1: Message[] = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' }
    ];
    await storage.save(sid, m1);
    const path = jsonlPaths(basePath, sid).jsonl;
    const afterFirst = (await fs.readFile(path, 'utf-8')).trimEnd().split('\n').length;

    await storage.save(sid, [...m1, { role: 'user', content: 'u2' }]);
    const afterSecond = (await fs.readFile(path, 'utf-8')).trimEnd().split('\n').length;

    expect(afterFirst).toBe(2);
    expect(afterSecond).toBe(3);
    const loaded = await storage.load(sid);
    expect(loaded).toHaveLength(3);
    expect(loaded[2]).toMatchObject({ role: 'user', content: 'u2' });
  });

  it('rewrites atomically when persisted slice is shorter than disk (compression)', async () => {
    const sid = 'sess-compact';
    const long: Message[] = Array.from({ length: 6 }, (_, i) => [
      { role: 'user' as const, content: `u${i}` },
      { role: 'assistant' as const, content: `a${i}` }
    ]).flat();

    await storage.save(sid, long);
    const path = jsonlPaths(basePath, sid).jsonl;
    expect((await fs.readFile(path, 'utf-8')).trimEnd().split('\n')).toHaveLength(12);

    const compressed: Message[] = [
      { role: 'user', content: 'summary synthetic' },
      { role: 'user', content: 'last-u' },
      { role: 'assistant', content: 'last-a' }
    ];
    await storage.save(sid, compressed);

    const lines = (await fs.readFile(path, 'utf-8')).trimEnd().split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    const loaded = await storage.load(sid);
    expect(loaded).toEqual(compressed);

    const meta = JSON.parse(await fs.readFile(jsonlPaths(basePath, sid).meta, 'utf-8'));
    expect(meta.messageCount).toBe(3);
  });

  it('rewrites when an earlier message is edited', async () => {
    const sid = 'sess-edit';
    await storage.save(sid, [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' }
    ]);
    await storage.save(sid, [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1-edited' }
    ]);
    const loaded = await storage.load(sid);
    expect(loaded).toHaveLength(2);
    expect(loaded[1]).toMatchObject({ role: 'assistant', content: 'a1-edited' });
  });

  it('save([]) clears transcript', async () => {
    const sid = 'sess-clear';
    const long: Message[] = Array.from({ length: 6 }, (_, i) => [
      { role: 'user' as const, content: `u${i}` },
      { role: 'assistant' as const, content: `a${i}` }
    ]).flat();
    await storage.save(sid, long);
    await storage.save(sid, []);
    const loaded = await storage.load(sid);
    expect(loaded).toEqual([]);
    const path = jsonlPaths(basePath, sid).jsonl;
    const raw = await fs.readFile(path, 'utf-8');
    expect(raw.trim()).toBe('');
  });

  it('does not persist system rows; meta messageCount excludes system', async () => {
    const sid = 'sess-sys';
    await storage.save(sid, [
      { role: 'system', content: 'should-not-appear' },
      { role: 'user', content: 'hi' }
    ]);
    const path = jsonlPaths(basePath, sid).jsonl;
    const text = await fs.readFile(path, 'utf-8');
    expect(text).not.toContain('should-not-appear');
    expect(text.trimEnd().split('\n').filter(Boolean)).toHaveLength(1);

    const meta = JSON.parse(await fs.readFile(jsonlPaths(basePath, sid).meta, 'utf-8'));
    expect(meta.messageCount).toBe(1);

    const loaded = await storage.load(sid);
    expect(loaded).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('load strips legacy persisted system lines', async () => {
    const sid = 'sess-legacy';
    const path = jsonlPaths(basePath, sid).jsonl;
    await fs.mkdir(basePath, { recursive: true });
    await fs.writeFile(
      path,
      JSON.stringify({ role: 'system', content: 'legacy', timestamp: 1 }) +
        '\n' +
        JSON.stringify({ role: 'user', content: 'keep', timestamp: 2 }) +
        '\n',
      'utf-8'
    );

    const loaded = await storage.load(sid);
    expect(loaded).toEqual([{ role: 'user', content: 'keep' }]);
  });

  it('meta file remains valid JSON after consecutive saves', async () => {
    const sid = 'sess-meta';
    await storage.save(sid, [{ role: 'user', content: 'a' }]);
    JSON.parse(await fs.readFile(jsonlPaths(basePath, sid).meta, 'utf-8'));
    await storage.save(sid, [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' }
    ]);
    const meta = JSON.parse(await fs.readFile(jsonlPaths(basePath, sid).meta, 'utf-8'));
    expect(meta.id).toBe(sid);
    expect(meta.messageCount).toBe(2);
  });
});
