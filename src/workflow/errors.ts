/** Base error for dynamic workflow failures. */
export class DynamicWorkflowError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The workflow script is malformed (bad meta, syntax error). */
export class WorkflowScriptError extends DynamicWorkflowError {}

/** The run-wide cap on total agent dispatches was hit. */
export class AgentLimitExceeded extends DynamicWorkflowError {}

/** The run's token budget was reached. */
export class BudgetExhausted extends DynamicWorkflowError {}

/** A stop was requested; the run unwinds at the next safe point. */
export class RunStopped extends DynamicWorkflowError {}

/** An agent never produced output matching the requested schema. */
export class SchemaValidationError extends DynamicWorkflowError {}

/**
 * Errors that must propagate through `parallel`/`pipeline` rather than becoming
 * a `null` result slot.
 */
export function isFatalError(error: unknown): boolean {
  return (
    error instanceof AgentLimitExceeded ||
    error instanceof RunStopped ||
    error instanceof BudgetExhausted
  );
}
