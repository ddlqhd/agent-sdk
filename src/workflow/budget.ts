import { BudgetExhausted } from './errors.js';

/** Track token usage against an optional ceiling. */
export interface BudgetTracker {
  total: number | null;
  spent(): number;
  remaining(): number;
  record(tokens: number): void;
  assertCanDispatch(): void;
}

export function createBudgetTracker(total: number | null): BudgetTracker {
  let spentTokens = 0;

  return {
    total,
    spent(): number {
      return spentTokens;
    },
    remaining(): number {
      if (total === null) return Infinity;
      return Math.max(0, total - spentTokens);
    },
    record(tokens: number): void {
      spentTokens += Math.max(0, tokens);
    },
    assertCanDispatch(): void {
      if (total !== null && spentTokens >= total) {
        throw new BudgetExhausted(`workflow token budget exhausted (${spentTokens}/${total})`);
      }
    }
  };
}

/** Sum token usage from an AgentResult. */
export function tokensFromAgentResult(usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number }): number {
  if (!usage) return 0;
  if (typeof usage.totalTokens === 'number') return usage.totalTokens;
  const input = typeof usage.inputTokens === 'number' ? usage.inputTokens : 0;
  const output = typeof usage.outputTokens === 'number' ? usage.outputTokens : 0;
  return input + output;
}
