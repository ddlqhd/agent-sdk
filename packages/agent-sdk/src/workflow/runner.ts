import { createBudgetTracker } from './budget.js';
import {
  RUN_FAILED,
  RUN_FINISHED,
  RUN_STARTED,
  MemorySink,
  NullSink,
  event
} from './events.js';
import { RunStopped } from './errors.js';
import { loadWorkflowScript } from './loader.js';
import { createDefaultAgentFactory, createPrimitives } from './primitives.js';
import { Scheduler } from './scheduler.js';
import type { RunWorkflowOptions, WorkflowRunContext, WorkflowRunResult } from './types.js';

/**
 * Compile and execute a workflow dialect script in-process.
 */
export async function runWorkflow(source: string, options: RunWorkflowOptions = {}): Promise<WorkflowRunResult> {
  const filename = options.filename ?? 'workflow.js';
  const loaded = loadWorkflowScript(source, filename);
  const sink = options.sink ?? new MemorySink();
  const budgetTracker = createBudgetTracker(options.budget ?? null);
  const baseAgentConfig = {
    ...options.agentConfig,
    modelConfig: options.modelConfig ?? options.agentConfig?.modelConfig
  };

  const ctx: WorkflowRunContext = {
    cwd: options.cwd ?? process.cwd(),
    args: options.args ?? null,
    currentPhase: '',
    budgetTotal: options.budget ?? null,
    tokensSpent: 0,
    scheduler: new Scheduler({
      concurrency: options.maxConcurrency ?? 4,
      maxAgents: options.maxAgents ?? 100,
      budgetGuard: () => budgetTracker.assertCanDispatch(),
      checkpoint: () => {
        if (options.signal?.aborted) {
          throw new RunStopped('workflow run aborted');
        }
      }
    }),
    sink,
    agentFactory: options.agentFactory ?? createDefaultAgentFactory(baseAgentConfig),
    baseAgentConfig,
    signal: options.signal
  };

  const primitives = createPrimitives(ctx);
  sink.emit(
    event(RUN_STARTED, {
      name: loaded.meta.name,
      description: loaded.meta.description
    })
  );

  try {
    const result = await loaded.run(primitives, ctx.args);
    sink.emit(
      event(RUN_FINISHED, {
        name: loaded.meta.name,
        tokensSpent: ctx.tokensSpent
      })
    );
    return {
      result,
      meta: loaded.meta,
      events: sink instanceof MemorySink ? sink.events : [],
      tokensSpent: ctx.tokensSpent
    };
  } catch (err) {
    sink.emit(
      event(RUN_FAILED, {
        name: loaded.meta.name,
        error: err instanceof Error ? err.message : String(err)
      })
    );
    throw err;
  }
}

export { NullSink, MemorySink };
