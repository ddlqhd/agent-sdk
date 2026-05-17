import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Agent } from '../../src/core/agent.js';
import { SessionManager } from '../../src/storage/session.js';
import { getSessionStoragePath } from '../../src/storage/session-path.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

/**
 * Regression: JsonlStorage used to only append when `messages.length` grew; after
 * context compression the in-memory list shrinks and nothing was written — resume
 * would reload the pre-compression transcript. This test would fail on that bug.
 */
const mockModel: ModelAdapter = {
  name: 'mock-compress-persist',
  async *stream(_params: ModelParams): AsyncIterable<StreamChunk> {
    yield { type: 'text', content: 'x' };
    yield { type: 'done' };
  },
  async complete() {
    return { content: 'Mock summary of conversation' };
  }
};

describe('Agent compressContext persists shortened history to JsonlStorage', () => {
  it('resume loads the same non-system transcript as in memory after compressContext', async () => {
    const userBase = await fs.mkdtemp(join(tmpdir(), 'compress-persist-'));

    const agent = new Agent({
      model: mockModel,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'jsonl' },
      userBasePath: userBase,
      contextManagement: {
        contextLength: 20_000,
        maxOutputTokens: 2_000,
        reserved: 2_000
      }
    });

    await agent.waitForInit();

    for (let i = 0; i < 10; i++) {
      await agent.run(`turn-${i}`);
    }

    const beforeCompress = agent.getMessages().filter((m) => m.role !== 'system').length;
    expect(beforeCompress).toBeGreaterThan(10);

    const { stats } = await agent.compressContext();
    expect(stats.compressedMessageCount).toBeLessThan(stats.originalMessageCount);

    const inMemoryNonSystem = agent.getMessages().filter((m) => m.role !== 'system').length;
    expect(inMemoryNonSystem).toBeLessThan(beforeCompress);

    const sid = agent.getSessionManager().sessionId!;
    const sm = new SessionManager({
      type: 'jsonl',
      basePath: getSessionStoragePath(userBase)
    });
    const fromDisk = await sm.resumeSession(sid);

    expect(fromDisk.length).toBe(inMemoryNonSystem);
    expect(fromDisk.length).toBeLessThan(beforeCompress);

    await fs.rm(userBase, { recursive: true, force: true }).catch(() => {});
  });
});
