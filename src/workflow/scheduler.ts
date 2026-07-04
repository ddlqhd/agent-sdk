import { AgentLimitExceeded, isFatalError } from './errors.js';

export interface SchedulerOptions {
  concurrency: number;
  maxAgents: number;
  checkpoint?: () => void | Promise<void>;
  budgetGuard?: () => void;
}

/** Bounded async fan-out with a runaway guard. */
export class Scheduler {
  private readonly concurrency: number;
  private readonly maxAgents: number;
  private readonly checkpoint: () => void | Promise<void>;
  private readonly budgetGuard: () => void;
  private dispatchedCount = 0;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: SchedulerOptions) {
    this.concurrency = Math.max(1, options.concurrency);
    this.maxAgents = options.maxAgents;
    this.checkpoint = options.checkpoint ?? (() => {});
    this.budgetGuard = options.budgetGuard ?? (() => {});
  }

  get dispatched(): number {
    return this.dispatchedCount;
  }

  /** Run one agent unit under the concurrency cap and total backstop. */
  async runAgent<T>(fn: () => Promise<T>): Promise<T> {
    await this.checkpoint();
    this.budgetGuard();
    if (this.dispatchedCount >= this.maxAgents) {
      throw new AgentLimitExceeded(`run reached its cap of ${this.maxAgents} agent dispatches`);
    }
    this.dispatchedCount++;

    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Run thunks concurrently; results in input order, `null` for recoverable failure. */
  async gather<T>(thunks: Array<() => Promise<T>>): Promise<Array<T | null>> {
    const settled = await Promise.allSettled(thunks.map((t) => t()));
    let fatal: unknown;
    const out: Array<T | null> = settled.map((r) => {
      if (r.status === 'fulfilled') return r.value;
      if (isFatalError(r.reason) && fatal === undefined) fatal = r.reason;
      return null;
    });
    if (fatal !== undefined) throw fatal;
    return out;
  }

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.active--;
    }
  }
}
