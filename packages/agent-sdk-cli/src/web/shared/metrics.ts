/**
 * 每轮（turn）与会话级指标的纯计算 / 格式化。
 *
 * 服务端（组装 WS 消息）与浏览器（渲染文本）共用，保证口径一致且便于单测。
 *
 * 口径：
 * - TPS 分母只用模型生成耗时（不含工具执行），分子为输出 tokens。
 * - 缓存命中率 = cacheRead / (input + cacheRead + cacheWrite)；
 *   `inputTokens` 是**未命中缓存**的输入，因此分母需要三项相加。
 * - 分母为 0，或缓存读写全为 0（如 Ollama 不回传缓存字段）时命中率为 `null`，显示 `—`。
 */

import type {
  SessionTokenUsage,
  SessionUsageSummary,
  TokenUsageDelta,
  TurnStats
} from '@ddlqhd/agent-sdk';

/** 兼容增量用量与累计用量两种形状 */
type UsageLike = TokenUsageDelta | SessionTokenUsage;

/** 本轮 / 会话消耗的 token 总量（输入 + 输出 + 缓存读 + 缓存写） */
export function usageTotal(usage: UsageLike): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

/** 缓存命中率 (0..1)；无法计算时返回 `null`（UI 显示 `—`） */
export function cacheHitRate(usage: UsageLike): number | null {
  const denominator = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  if (denominator <= 0) return null;
  if (usage.cacheReadTokens + usage.cacheWriteTokens === 0) return null;
  return usage.cacheReadTokens / denominator;
}

/** 本轮 TPS（tok/s）：输出 tokens / 模型生成耗时；无法计算时返回 `null` */
export function turnTps(turn: TurnStats): number | null {
  return tokensPerSecond(turn.usage.outputTokens, turn.generationMs);
}

/** 会话平均 TPS：累计输出 tokens / 累计模型生成耗时；无法计算时返回 `null` */
export function sessionTps(summary: SessionUsageSummary): number | null {
  return tokensPerSecond(summary.usage.outputTokens, summary.generationMs);
}

function tokensPerSecond(outputTokens: number, generationMs: number): number | null {
  if (outputTokens <= 0 || generationMs <= 0) return null;
  return outputTokens / (generationMs / 1000);
}

/** 千分位整数，如 `1,234` */
export function formatCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

/** 时长：`0.8s` / `3.4s` / `1m 12s` */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 60_000) {
    return `${(safe / 1000).toFixed(1)}s`;
  }
  const totalSeconds = Math.round(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/** TPS：`48.3 tok/s`；无法计算时 `—` */
export function formatTps(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} tok/s`;
}

/** 百分比：`62%`；无法计算时 `—` */
export function formatPercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

function tokenBreakdown(usage: UsageLike): string {
  const parts = [
    `输入 ${formatCount(usage.inputTokens)}`,
    `输出 ${formatCount(usage.outputTokens)}`
  ];
  if (usage.cacheReadTokens > 0) {
    parts.push(`缓存读 ${formatCount(usage.cacheReadTokens)}`);
  }
  if (usage.cacheWriteTokens > 0) {
    parts.push(`缓存写 ${formatCount(usage.cacheWriteTokens)}`);
  }
  return parts.join(' · ');
}

/**
 * 单轮指标行（回复下方的灰色小字），例如：
 *
 * `101.9 tok/s · 5,234 tokens（输入 1,020 · 输出 214 · 缓存读 4,000） · 缓存命中 80% · 耗时 3.4s（生成 2.1s）`
 */
export function formatTurnStats(stats: TurnStats): string {
  return [
    formatTps(turnTps(stats)),
    `${formatCount(usageTotal(stats.usage))} tokens（${tokenBreakdown(stats.usage)}）`,
    `缓存命中 ${formatPercent(cacheHitRate(stats.usage))}`,
    `耗时 ${formatDuration(stats.durationMs)}（生成 ${formatDuration(stats.generationMs)}）`
  ].join(' · ');
}

/**
 * 会话累计指标行（输入框下方），例如：
 *
 * `会话 12 轮 · 33,432 tokens（输入 6,910 · 输出 1,522 · 缓存读 20,000 · 缓存写 5,000） · 缓存命中 63% · 平均 24.8 tok/s · 累计 1m 36s（生成 1m 1s）`
 */
export function formatSessionStats(summary: SessionUsageSummary): string {
  return [
    `会话 ${formatCount(summary.turns)} 轮`,
    `${formatCount(usageTotal(summary.usage))} tokens（${tokenBreakdown(summary.usage)}）`,
    `缓存命中 ${formatPercent(cacheHitRate(summary.usage))}`,
    `平均 ${formatTps(sessionTps(summary))}`,
    `累计 ${formatDuration(summary.durationMs)}（生成 ${formatDuration(summary.generationMs)}）`
  ].join(' · ');
}
