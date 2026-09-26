import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Agent } from '../../packages/agent-sdk/src/core/agent.js';
import type {
  AgentConfig,
  ModelAdapter,
  ModelParams,
  StreamChunk
} from '../../packages/agent-sdk/src/core/types.js';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

function usageModel(
  rounds: Array<{ input: number; output: number }>
): ModelAdapter {
  let call = 0;
  return {
    name: 'usage-model',
    async *stream(_params: ModelParams): AsyncIterable<StreamChunk> {
      const u = rounds[call] ?? { input: 0, output: 0 };
      call++;
      if (u.input > 0) {
        yield {
          type: 'metadata',
          usagePhase: 'input',
          metadata: {
            usage: { promptTokens: u.input, completionTokens: 0, totalTokens: u.input }
          }
        };
      }
      if (u.output > 0) {
        yield {
          type: 'metadata',
          usagePhase: 'output',
          metadata: {
            usage: { promptTokens: 0, completionTokens: u.output, totalTokens: u.output }
          }
        };
      }
      yield { type: 'text', content: 'ok' };
      yield { type: 'done' };
    },
    async complete() {
      return { content: 'ok' };
    }
  };
}

describe('Agent session usage', () => {
  it('accumulates input/output across model_usage events', async () => {
    const agent = new Agent({
      model: usageModel([{ input: 100, output: 50 }]),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'memory' },
      contextManagement: false
    });
    await agent.waitForInit();

    for await (const _ of agent.stream('hi')) {
      /* drain */
    }

    const usage = agent.getSessionUsage();
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
    expect(usage.totalTokens).toBe(150);
    expect(usage.contextTokens).toBe(100);
  });

  it('session_summary.usage matches getSessionUsage mapping', async () => {
    const agent = new Agent({
      model: usageModel([{ input: 200, output: 80 }]),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'memory' },
      contextManagement: false
    });
    await agent.waitForInit();

    let summaryUsage:
      | { promptTokens: number; completionTokens: number; totalTokens: number }
      | undefined;
    for await (const event of agent.stream('hi')) {
      if (event.type === 'session_summary') {
        summaryUsage = event.usage;
      }
    }

    const session = agent.getSessionUsage();
    expect(summaryUsage).toEqual({
      promptTokens: session.inputTokens,
      completionTokens: session.outputTokens,
      totalTokens: session.totalTokens
    });
  });

  it('accumulates usage across multiple stream() calls on the same session', async () => {
    const agent = new Agent({
      model: usageModel([
        { input: 100, output: 40 },
        { input: 150, output: 60 }
      ]),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'memory' },
      contextManagement: false
    });
    await agent.waitForInit();

    for await (const _ of agent.stream('first')) {
      /* drain */
    }
    for await (const _ of agent.stream('second')) {
      /* drain */
    }

    const usage = agent.getSessionUsage();
    expect(usage.inputTokens).toBe(250);
    expect(usage.outputTokens).toBe(100);
    expect(usage.totalTokens).toBe(350);
  });

  it('rewind preserves cumulative input/output and clears contextTokens', async () => {
    const agent = new Agent({
      model: usageModel([
        { input: 100, output: 50 },
        { input: 150, output: 60 }
      ]),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'memory' },
      contextManagement: false
    });
    await agent.waitForInit();

    for await (const _ of agent.stream('first')) {
      /* drain */
    }
    for await (const _ of agent.stream('second')) {
      /* drain */
    }

    const beforeRewind = agent.getSessionUsage();
    expect(beforeRewind.inputTokens).toBe(250);
    expect(beforeRewind.outputTokens).toBe(110);
    expect(beforeRewind.contextTokens).toBe(150);

    await agent.rewindToCheckpoint({ userTurnIndex: 0 });

    const afterRewind = agent.getSessionUsage();
    expect(afterRewind.inputTokens).toBe(250);
    expect(afterRewind.outputTokens).toBe(110);
    expect(afterRewind.contextTokens).toBe(0);
  });

  it('exposes per-turn stats, persists usage rows to jsonl and restores them on resume', async () => {
    const userBase = await fs.mkdtemp(join(tmpdir(), 'session-usage-'));
    // 单个 model 实例跨两个 Agent 共享：第二个实例的第一轮取第二组 usage
    const model = usageModel([
      { input: 100, output: 50 },
      { input: 150, output: 60 }
    ]);
    const makeConfig = (): AgentConfig => ({
      model,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'jsonl' },
      userBasePath: userBase,
      contextManagement: false
    });

    const agent = new Agent(makeConfig());
    await agent.waitForInit();
    expect(agent.getLastTurnStats()).toBeUndefined();

    for await (const _ of agent.stream('first')) {
      /* drain */
    }

    const turn = agent.getLastTurnStats();
    expect(turn).toBeDefined();
    expect(turn!.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0
    });
    expect(turn!.durationMs).toBeGreaterThanOrEqual(0);
    expect(turn!.generationMs).toBeGreaterThanOrEqual(0);

    const beforeResume = agent.getSessionUsageSummary();
    expect(beforeResume.turns).toBe(1);
    expect(beforeResume.usage.inputTokens).toBe(100);
    expect(beforeResume.usage.outputTokens).toBe(50);
    expect(beforeResume.durationMs).toBeGreaterThanOrEqual(0);
    const sessionId = agent.getSessionManager().sessionId!;

    // 新 Agent 实例恢复同一会话：累计用量 / 轮次从 jsonl 重算
    const resumed = new Agent(makeConfig());
    await resumed.waitForInit();
    for await (const _ of resumed.stream('second', { sessionId })) {
      /* drain */
    }

    const after = resumed.getSessionUsageSummary();
    expect(after.turns).toBe(2);
    expect(after.usage.inputTokens).toBe(250);
    expect(after.usage.outputTokens).toBe(110);
    expect(after.generationMs).toBeGreaterThanOrEqual(0);
    expect(after.durationMs).toBeGreaterThanOrEqual(beforeResume.durationMs);

    // usage 元行不会被当成消息恢复
    const messages = await resumed.getSessionManager().loadActiveMessages();
    expect(messages).toHaveLength(4);
    expect(messages.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);

    await fs.rm(userBase, { recursive: true, force: true }).catch(() => {});
  });

  it('rewind keeps persisted usage rows (spent tokens are never dropped)', async () => {
    const userBase = await fs.mkdtemp(join(tmpdir(), 'session-usage-rewind-'));
    const model = usageModel([
      { input: 100, output: 50 },
      { input: 150, output: 60 }
    ]);
    const makeConfig = (): AgentConfig => ({
      model,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'jsonl' },
      userBasePath: userBase,
      contextManagement: false
    });

    const agent = new Agent(makeConfig());
    await agent.waitForInit();
    for await (const _ of agent.stream('first')) {
      /* drain */
    }
    for await (const _ of agent.stream('second')) {
      /* drain */
    }

    await agent.rewindToCheckpoint({ userTurnIndex: 0 });

    const summary = agent.getSessionUsageSummary();
    expect(summary.turns).toBe(2);
    expect(summary.usage.inputTokens).toBe(250);
    expect(summary.usage.outputTokens).toBe(110);

    // 重新加载后仍能从 jsonl 重算出同样的累计值
    const reloaded = new Agent(makeConfig());
    await reloaded.waitForInit();
    await reloaded.getSessionManager().attachSession(summarySessionId(agent));
    const restored = await reloaded.reloadSessionUsage();
    expect(restored.turns).toBe(2);
    expect(restored.usage.inputTokens).toBe(250);
    expect(restored.usage.outputTokens).toBe(110);

    await fs.rm(userBase, { recursive: true, force: true }).catch(() => {});
  });

  it('keeps pre-turn counters when persisting the usage row fails', async () => {
    const agent = new Agent({
      model: usageModel([{ input: 100, output: 50 }]),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'memory' },
      contextManagement: false
    });
    await agent.waitForInit();
    vi.spyOn(agent.getSessionManager(), 'appendUsageEntry').mockRejectedValue(new Error('disk full'));

    for await (const _ of agent.stream('hi')) {
      /* drain */
    }

    const summary = agent.getSessionUsageSummary();
    expect(summary.turns).toBe(0);
    expect(summary.generationMs).toBe(0);
    expect(summary.durationMs).toBe(0);
    expect(summary.usage.inputTokens).toBe(0);
    expect(summary.usage.outputTokens).toBe(0);
    expect(summary.usage.contextTokens).toBe(100);
    expect(agent.getLastTurnStats()?.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0
    });
  });
});

function summarySessionId(agent: Agent): string {
  const id = agent.getSessionManager().sessionId;
  if (!id) throw new Error('expected an attached session');
  return id;
}
