import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Agent } from '../../packages/agent-sdk/src/core/agent.js';
import { SessionManager } from '../../packages/agent-sdk/src/storage/session.js';
import { getSessionStoragePath } from '../../packages/agent-sdk/src/storage/session-path.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../packages/agent-sdk/src/core/types.js';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

const mockModel: ModelAdapter = {
  name: 'session-meta-mock',
  async *stream(_params: ModelParams): AsyncIterable<StreamChunk> {
    yield { type: 'text', content: 'ok' };
    yield { type: 'done' };
  },
  async complete() {
    return { content: 'ok' };
  }
};

describe('Agent.stream persists session meta', () => {
  it('writes cwd and agentName to SessionInfo after stream', async () => {
    const userBase = await fs.mkdtemp(join(tmpdir(), 'agent-session-meta-'));
    const cwd = join(userBase, 'workspace');
    await fs.mkdir(cwd, { recursive: true });

    const agent = new Agent({
      model: mockModel,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'jsonl' },
      userBasePath: userBase,
      cwd,
      agentName: 'ReviewBot',
      contextManagement: false
    });
    await agent.waitForInit();

    for await (const _event of agent.stream('hello')) {
      /* drain */
    }

    const sid = agent.getSessionManager().sessionId!;
    const sm = new SessionManager({
      type: 'jsonl',
      basePath: getSessionStoragePath(userBase)
    });
    const info = await sm.getSessionInfo(sid);
    expect(info?.cwd).toBe(cwd);
    expect(info?.agentName).toBe('ReviewBot');
    expect(info?.messageCount).toBeGreaterThan(0);

    await fs.rm(userBase, { recursive: true, force: true }).catch(() => {});
  });
});
