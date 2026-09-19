import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Agent, StreamEvent } from '@ddlqhd/agent-sdk';
import {
  describeMissingKey,
  requireProviderKey,
  resolveAcpUserBase,
  resolveModel,
  resolveModelBaseUrl,
  resolveProvider,
  resolveRemoteEnvironmentConfig,
  resolveUserBasePath,
  runTurn,
  SessionRuntime
} from '@ddlqhd/agent-sdk-control';

describe('control env', () => {
  const original = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
  });

  it('resolves provider from host env then API keys', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AGENT_SDK_ACP_PROVIDER = 'anthropic';
    expect(resolveProvider({ providerEnv: 'AGENT_SDK_ACP_PROVIDER' })).toBe('anthropic');
  });

  it('resolves model from host env', () => {
    process.env.AGENT_SDK_ACP_MODEL = 'gpt-test';
    expect(resolveModel('openai', { modelEnv: 'AGENT_SDK_ACP_MODEL' })).toBe('gpt-test');
  });

  it('resolves OpenAI base URL from env', () => {
    expect(
      resolveModelBaseUrl('openai', undefined, { OPENAI_BASE_URL: 'http://127.0.0.1:9/v1' })
    ).toBe('http://127.0.0.1:9/v1');
  });

  it('reads provider keys', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(requireProviderKey('openai')).toBe('sk-test');
    expect(requireProviderKey('ollama')).toBeUndefined();
    expect(describeMissingKey('anthropic')).toMatch(/ANTHROPIC_API_KEY/);
  });
});

describe('control user-base', () => {
  const original = process.env.AGENT_SDK_ACP_USER_BASE;

  afterEach(() => {
    if (original === undefined) delete process.env.AGENT_SDK_ACP_USER_BASE;
    else process.env.AGENT_SDK_ACP_USER_BASE = original;
  });

  it('prefers explicit path', () => {
    expect(resolveUserBasePath({ explicit: '/x', fallback: 'home' })).toBe('/x');
  });

  it('uses ACP tmp fallback', () => {
    delete process.env.AGENT_SDK_ACP_USER_BASE;
    expect(resolveAcpUserBase()).toBe(join(tmpdir(), 'agent-sdk-acp'));
  });
});

describe('remote environment', () => {
  it('reads explicit url over env', () => {
    const ref = resolveRemoteEnvironmentConfig({
      url: 'ws://host:1',
      token: 't',
      env: { AGENT_SDK_EXEC_SERVER_URL: 'ws://other:2' }
    });
    expect(ref).toEqual({ type: 'remote', url: 'ws://host:1', token: 't' });
  });

  it('ignores none', () => {
    expect(
      resolveRemoteEnvironmentConfig({ env: { AGENT_SDK_EXEC_SERVER_URL: 'none' } })
    ).toBeUndefined();
  });
});

function createFakeAgent(): Agent {
  const ids = new Set<string>();
  return {
    getSessionManager: () => ({
      createSession: (id?: string) => {
        const sid = id ?? 'generated';
        ids.add(sid);
        return sid;
      },
      attachSession: async (id: string) => {
        if (!ids.has(id)) throw new Error(`missing ${id}`);
      },
      loadActiveMessages: async () => [],
      listSessions: async () =>
        [...ids].map((id) => ({
          id,
          createdAt: 1,
          updatedAt: 2,
          messageCount: 0
        })),
      sessionExists: async (id: string) => ids.has(id),
      deleteSession: async (id: string) => {
        ids.delete(id);
      },
      sessionId: null
    }),
    stream: async function* () {
      yield { type: 'text_delta', content: 'hi', timestamp: 1 } as StreamEvent;
      yield { type: 'end', reason: 'complete', timestamp: 2 } as StreamEvent;
    },
    destroy: async () => {},
    forkSession: async (source: string, opts?: { newSessionId?: string }) => ({
      sessionId: opts?.newSessionId ?? 'forked',
      sourceSessionId: source,
      messageCount: 1
    })
  } as unknown as Agent;
}

describe('runTurn', () => {
  it('collects text and forwards events to the sink', async () => {
    const seen: string[] = [];
    const result = await runTurn({
      agent: createFakeAgent(),
      text: 'hello',
      sessionId: 's1',
      sink: {
        onEvent: (event) => {
          seen.push(event.type);
        }
      }
    });
    expect(result.finalText).toBe('hi');
    expect(result.endReason).toBe('complete');
    expect(result.aborted).toBe(false);
    expect(seen).toEqual(['text_delta', 'end']);
  });

  it('treats abort as a cancelled turn', async () => {
    const ac = new AbortController();
    const agent = {
      ...createFakeAgent(),
      stream: async function* () {
        ac.abort();
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
    } as unknown as Agent;
    const result = await runTurn({ agent, text: 'x', signal: ac.signal });
    expect(result.aborted).toBe(true);
    expect(result.endReason).toBe('aborted');
  });
});

describe('SessionRuntime', () => {
  it('creates, prompts, and destroys a session', async () => {
    const runtime = new SessionRuntime({
      resolveUserBasePath: () => join(tmpdir(), 'agent-sdk-control-test'),
      storageType: 'memory',
      createExtra: () => ({ tag: 'ok' }),
      buildAgent: async () => createFakeAgent()
    });

    const created = await runtime.create('/proj', 'sess-1');
    expect(created.sessionId).toBe('sess-1');
    expect(created.extra).toEqual({ tag: 'ok' });
    expect(runtime.get('sess-1')?.cwd).toBe('/proj');

    const turn = await runtime.prompt('sess-1', 'hi');
    expect(turn.finalText).toBe('hi');

    const listed = await runtime.list();
    expect(listed.sessions.map((s) => s.id)).toContain('sess-1');

    await runtime.destroyAll();
    expect(runtime.get('sess-1')).toBeUndefined();
  });
});
