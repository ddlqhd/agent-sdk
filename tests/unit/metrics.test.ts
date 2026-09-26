import { describe, it, expect } from 'vitest';
import type { SessionUsageSummary, TurnStats } from '../../packages/agent-sdk/src/core/types.js';
import {
  cacheHitRate,
  formatCount,
  formatDuration,
  formatPercent,
  formatSessionStats,
  formatTps,
  formatTurnStats,
  sessionTps,
  turnTps,
  usageTotal
} from '../../packages/agent-sdk-cli/src/web/shared/metrics.js';

const turn: TurnStats = {
  usage: {
    inputTokens: 1020,
    outputTokens: 214,
    cacheReadTokens: 4000,
    cacheWriteTokens: 0
  },
  durationMs: 3400,
  generationMs: 2100
};

const summary: SessionUsageSummary = {
  usage: {
    contextTokens: 0,
    inputTokens: 6910,
    outputTokens: 1522,
    cacheReadTokens: 20000,
    cacheWriteTokens: 5000,
    totalTokens: 8432
  },
  turns: 12,
  generationMs: 61400,
  durationMs: 96200
};

describe('web shared metrics', () => {
  it('computes cache hit rate over uncached input + cache read + cache write', () => {
    expect(cacheHitRate(turn.usage)).toBeCloseTo(4000 / (1020 + 4000 + 0), 6);
    // 缓存读写全为 0（Ollama 等不回传缓存字段）→ 显示「—」而不是 0%
    expect(cacheHitRate({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
    // 分母为 0 → 无法计算
    expect(cacheHitRate({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
    // 只有缓存写入时命中率为 0%
    expect(cacheHitRate({ inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 50 })).toBe(0);
  });

  it('computes TPS from output tokens and generation time only', () => {
    expect(turnTps(turn)).toBeCloseTo(214 / 2.1, 6);
    expect(turnTps({ ...turn, generationMs: 0 })).toBeNull();
    expect(turnTps({ ...turn, usage: { ...turn.usage, outputTokens: 0 } })).toBeNull();
    expect(sessionTps(summary)).toBeCloseTo(1522 / 61.4, 6);
    expect(sessionTps({ ...summary, generationMs: 0 })).toBeNull();
  });

  it('totals tokens across input, output and cache', () => {
    expect(usageTotal(turn.usage)).toBe(1020 + 214 + 4000);
    expect(usageTotal(summary.usage)).toBe(6910 + 1522 + 20000 + 5000);
  });

  it('formats counts, durations, rates and percentages', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatDuration(800)).toBe('0.8s');
    expect(formatDuration(3400)).toBe('3.4s');
    expect(formatDuration(61000)).toBe('1m 1s');
    expect(formatDuration(96200)).toBe('1m 36s');
    expect(formatTps(48.34)).toBe('48.3 tok/s');
    expect(formatTps(null)).toBe('—');
    expect(formatPercent(0.617)).toBe('62%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(null)).toBe('—');
  });

  it('formats the per-turn line', () => {
    expect(formatTurnStats(turn)).toBe(
      '101.9 tok/s · 5,234 tokens（输入 1,020 · 输出 214 · 缓存读 4,000） · 缓存命中 80% · 耗时 3.4s（生成 2.1s）'
    );
  });

  it('renders em dashes for a turn without cache or timing info', () => {
    const bare: TurnStats = {
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      durationMs: 0,
      generationMs: 0
    };
    expect(formatTurnStats(bare)).toBe(
      '— · 0 tokens（输入 0 · 输出 0） · 缓存命中 — · 耗时 0.0s（生成 0.0s）'
    );
  });

  it('formats the session line', () => {
    expect(formatSessionStats(summary)).toBe(
      '会话 12 轮 · 33,432 tokens（输入 6,910 · 输出 1,522 · 缓存读 20,000 · 缓存写 5,000） · 缓存命中 63% · 平均 24.8 tok/s · 累计 1m 36s（生成 1m 1s）'
    );
  });
});
