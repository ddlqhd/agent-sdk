import { describe, it, expect } from 'vitest';
import { Scheduler } from '../../src/workflow/scheduler.js';
import { AgentLimitExceeded, BudgetExhausted } from '../../src/workflow/errors.js';
import { createBudgetTracker } from '../../src/workflow/budget.js';

describe('workflow scheduler', () => {
  it('limits concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const scheduler = new Scheduler({ concurrency: 2, maxAgents: 10 });

    const task = async (ms: number) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, ms));
      active--;
      return ms;
    };

    const results = await scheduler.gather([
      () => scheduler.runAgent(() => task(30)),
      () => scheduler.runAgent(() => task(30)),
      () => scheduler.runAgent(() => task(30)),
      () => scheduler.runAgent(() => task(30))
    ]);

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([30, 30, 30, 30]);
  });

  it('returns null for recoverable failures and preserves order', async () => {
    const scheduler = new Scheduler({ concurrency: 4, maxAgents: 10 });
    const results = await scheduler.gather([
      () => scheduler.runAgent(async () => 'a'),
      () => scheduler.runAgent(async () => {
        throw new Error('boom');
      }),
      () => scheduler.runAgent(async () => 'c')
    ]);
    expect(results).toEqual(['a', null, 'c']);
  });

  it('throws AgentLimitExceeded when maxAgents is hit', async () => {
    const scheduler = new Scheduler({ concurrency: 1, maxAgents: 1 });
    await scheduler.runAgent(async () => 'ok');
    await expect(scheduler.runAgent(async () => 'x')).rejects.toBeInstanceOf(AgentLimitExceeded);
  });

  it('rethrows fatal budget errors from gather', async () => {
    const budget = createBudgetTracker(0);
    budget.record(1);
    const scheduler = new Scheduler({
      concurrency: 2,
      maxAgents: 10,
      budgetGuard: () => budget.assertCanDispatch()
    });

    await expect(
      scheduler.gather([
        () => scheduler.runAgent(async () => 'a'),
        () => scheduler.runAgent(async () => 'b')
      ])
    ).rejects.toBeInstanceOf(BudgetExhausted);
  });
});

describe('workflow budget', () => {
  it('tracks spent and remaining tokens', () => {
    const budget = createBudgetTracker(100);
    budget.record(30);
    budget.record(20);
    expect(budget.spent()).toBe(50);
    expect(budget.remaining()).toBe(50);
  });

  it('throws when budget exhausted', () => {
    const budget = createBudgetTracker(10);
    budget.record(10);
    expect(() => budget.assertCanDispatch()).toThrow(BudgetExhausted);
  });
});
