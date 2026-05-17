import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryStorage } from '../../src/storage/memory.js';
import { SessionManager } from '../../src/storage/session.js';
import { JsonlStorage } from '../../src/storage/jsonl.js';

describe('MemoryStorage', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('append + load roundtrip', async () => {
    const sid = 's1';
    await storage.append(sid, [{ role: 'user', content: 'Hello' }]);
    await storage.append(sid, [{ role: 'assistant', content: 'Hi!' }]);
    const loaded = await storage.load(sid);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toMatchObject({ role: 'user', content: 'Hello' });
  });

  it('returns empty load for missing session', async () => {
    expect(await storage.load('missing')).toEqual([]);
  });

  it('exists after append', async () => {
    await storage.append('x', [{ role: 'user', content: 'a' }]);
    expect(await storage.exists('x')).toBe(true);
  });

  it('delete removes session', async () => {
    await storage.append('d', [{ role: 'user', content: 'a' }]);
    await storage.delete('d');
    expect(await storage.exists('d')).toBe(false);
  });
});

describe('JsonlStorage', () => {
  let basePath: string;
  let storage: JsonlStorage;

  beforeEach(async () => {
    basePath = await fs.mkdtemp(join(tmpdir(), 'stor-test-'));
    storage = new JsonlStorage({ basePath });
  });

  afterEach(async () => {
    await storage.clear().catch(() => {});
    await fs.rm(basePath, { recursive: true, force: true }).catch(() => {});
  });

  it('append + load roundtrip', async () => {
    const sid = 's1';
    await storage.append(sid, [{ role: 'user', content: 'Hello' }]);
    await storage.append(sid, [{ role: 'assistant', content: 'Hi!' }]);
    const loaded = await storage.load(sid);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toMatchObject({ role: 'user', content: 'Hello' });
  });

  it('returns empty load for missing session', async () => {
    expect(await storage.load('missing')).toEqual([]);
  });

  it('exists after append', async () => {
    await storage.append('x', [{ role: 'user', content: 'a' }]);
    expect(await storage.exists('x')).toBe(true);
  });

  it('delete removes session', async () => {
    await storage.append('d', [{ role: 'user', content: 'a' }]);
    await storage.delete('d');
    expect(await storage.exists('d')).toBe(false);
  });
});

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({ type: 'memory' });
  });

  it('creates a new session', () => {
    const id = manager.createSession();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(manager.sessionId).toBe(id);
  });

  it('createSession with custom ID', () => {
    const id = manager.createSession('custom-id');
    expect(id).toBe('custom-id');
  });

  it('appendEntries + loadActiveMessages', async () => {
    manager.createSession('custom');
    await manager.appendEntries([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' }
    ]);
    const active = await manager.loadActiveMessages();
    expect(active).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' }
    ]);
  });

  it('resume another manager via memory import', async () => {
    manager.createSession('test');
    await manager.appendEntries([{ role: 'user', content: 'Hello' }]);

    const manager2 = new SessionManager({ type: 'memory' });
    const storage = manager.getStorage() as MemoryStorage;
    const manager2Storage = manager2.getStorage() as MemoryStorage;
    manager2Storage.import(storage.export());

    await manager2.attachSession('test');
    const messages = await manager2.loadActiveMessages();
    expect(messages).toHaveLength(1);
    expect(manager2.sessionId).toBe('test');
  });

  it('throws on attachSession when missing', async () => {
    await expect(manager.attachSession('non-existent')).rejects.toThrow('not found');
  });

  it('deletes session', async () => {
    manager.createSession('test');
    await manager.appendEntries([{ role: 'user', content: 'Hi' }]);
    await manager.deleteSession('test');
    expect(manager.sessionId).toBeNull();
  });

  it('lists sessions', async () => {
    manager.createSession('session-a');
    await manager.appendEntries([{ role: 'user', content: '1' }]);
    manager.createSession('session-b');
    await manager.appendEntries([{ role: 'user', content: '2' }]);

    const sessions = await manager.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
  });
});
