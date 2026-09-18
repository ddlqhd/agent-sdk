export const RUN_STARTED = 'run_started';
export const RUN_FINISHED = 'run_finished';
export const RUN_FAILED = 'run_failed';
export const RUN_STOPPED = 'run_stopped';
export const PHASE_STARTED = 'phase_started';
export const LOG = 'log';
export const AGENT_STARTED = 'agent_started';
export const AGENT_FINISHED = 'agent_finished';
export const AGENT_FAILED = 'agent_failed';

export interface WorkflowEvent {
  ts: number;
  type: string;
  [key: string]: unknown;
}

/** Build a timestamped event record. */
export function event(type: string, fields: Record<string, unknown> = {}): WorkflowEvent {
  return { ts: Date.now() / 1000, type, ...fields };
}

/** Anything that can receive progress events. */
export interface EventSink {
  emit(ev: WorkflowEvent): void;
}

/** Drops every event. */
export class NullSink implements EventSink {
  emit(_ev: WorkflowEvent): void {
    // intentionally empty
  }
}

/** Collects events in memory. */
export class MemorySink implements EventSink {
  readonly events: WorkflowEvent[] = [];

  emit(ev: WorkflowEvent): void {
    this.events.push(ev);
  }

  ofType(type: string): WorkflowEvent[] {
    return this.events.filter((e) => e.type === type);
  }
}
