import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStorage } from '../../src/storage/memory.js';
import { SessionManager } from '../../src/storage/session.js';

describe('MemoryStorage', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('should save and load messages', async () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there!' }
    ];

    await storage.save('test-session', messages);
    const loaded = await storage.load('test-session');

    expect(loaded).toEqual(messages);
  });

  it('should return empty array for non-existent session', async () => {
    const messages = await storage.load('non-existent');
    expect(messages).toEqual([]);
  });

  it('should list sessions', async () => {
    await storage.save('session1', [{ role: 'user', content: 'Hi' }]);
    await storage.save('session2', [{ role: 'user', content: 'Hello' }]);

    const sessions = await storage.list();
    expect(sessions).toHaveLength(2);
    expect(sessions.map(s => s.id)).toContain('session1');
    expect(sessions.map(s => s.id)).toContain('session2');
  });

  it('should delete a session', async () => {
    await storage.save('test-session', [{ role: 'user', content: 'Hi' }]);
    expect(await storage.exists('test-session')).toBe(true);

    await storage.delete('test-session');
    expect(await storage.exists('test-session')).toBe(false);
  });

  it('should check session existence', async () => {
    expect(await storage.exists('test')).toBe(false);
    
    await storage.save('test', [{ role: 'user', content: 'Hi' }]);
    expect(await storage.exists('test')).toBe(true);
  });

  it('should clear all sessions', async () => {
    await storage.save('session1', []);
    await storage.save('session2', []);

    expect(storage.size).toBe(2);

    await storage.clear();
    expect(storage.size).toBe(0);
  });

  it('should export and import data', async () => {
    const messages = [{ role: 'user' as const, content: 'Hello' }];
    await storage.save('test', messages);

    const exported = storage.export();
    expect(exported['test']).toEqual(messages);

    const newStorage = new MemoryStorage();
    newStorage.import(exported);

    const loaded = await newStorage.load('test');
    expect(loaded).toEqual(messages);
  });
});

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({ type: 'memory' });
  });

  it('should create a new session', () => {
    const id = manager.createSession();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(manager.sessionId).toBe(id);
  });

  it('should create session with custom ID', () => {
    const id = manager.createSession('custom-id');
    expect(id).toBe('custom-id');
    expect(manager.sessionId).toBe('custom-id');
  });

  it('should save and load messages', async () => {
    manager.createSession('test');
    
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi!' }
    ];

    await manager.saveMessages(messages);
    const loaded = await manager.loadMessages();

    expect(loaded).toEqual(messages);
  });

  it('should append a message', async () => {
    manager.createSession('test');

    await manager.appendMessage({ role: 'user', content: 'First' });
    await manager.appendMessage({ role: 'assistant', content: 'Second' });

    const messages = await manager.loadMessages();
    expect(messages).toHaveLength(2);
  });

  it('should resume an existing session', async () => {
    manager.createSession('test');
    await manager.saveMessages([{ role: 'user', content: 'Hello' }]);

    const manager2 = new SessionManager({ type: 'memory' });
    // Manually copy data for memory storage test
    const storage = manager.getStorage() as MemoryStorage;
    const manager2Storage = manager2.getStorage() as MemoryStorage;
    manager2Storage.import(storage.export());

    const messages = await manager2.resumeSession('test');
    expect(messages).toHaveLength(1);
    expect(manager2.sessionId).toBe('test');
  });

  it('should throw on non-existent session resume', async () => {
    await expect(manager.resumeSession('non-existent')).rejects.toThrow('not found');
  });

  it('should delete a session', async () => {
    manager.createSession('test');
    await manager.saveMessages([{ role: 'user', content: 'Hi' }]);

    await manager.deleteSession('test');
    expect(manager.sessionId).toBeNull();
  });

  it('should list sessions', async () => {
    await manager.saveMessages([{ role: 'user', content: '1' }]);
    manager.createSession('session2');
    await manager.saveMessages([{ role: 'user', content: '2' }]);

    const sessions = await manager.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
  });
});
