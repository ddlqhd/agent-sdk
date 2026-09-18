import type { z } from 'zod';
import type { Agent } from '../core/agent.js';
import type { AgentConfig, AgentModelConfig, AgentResult } from '../core/types.js';
import type { EventSink, WorkflowEvent } from './events.js';
import type { Scheduler } from './scheduler.js';

/** Phase metadata declared in workflow `meta.phases`. */
export interface WorkflowPhaseMeta {
  title: string;
  detail?: string;
  model?: string;
}

/** Workflow metadata extracted from `export const meta = { ... }`. */
export interface WorkflowMeta {
  name: string;
  description: string;
  whenToUse?: string;
  phases?: WorkflowPhaseMeta[];
  model?: string;
}

/** Options passed to the `agent()` primitive. */
export interface AgentPrimitiveOptions {
  /** Short label for progress display. */
  label?: string;
  /** Override the current phase for this one call. */
  phase?: string;
  /** When set, the reply is validated and returned as a structured object. */
  schema?: z.ZodType;
  /** Optional model id override for this agent call. */
  model?: string;
  /** Optional system prompt override for this agent call. */
  systemPrompt?: string;
  /** Max schema validation retries (default 2). */
  schemaRetries?: number;
}

export type Thunk<T> = () => Promise<T> | T;
export type PipelineStage = (previous: unknown, item: unknown, index: number) => unknown;

/** Token budget exposed to workflow scripts via `budget`. */
export interface WorkflowBudget {
  total: number | null;
  spent(): number;
  remaining(): number;
}

/** What `validate(source)` reports about a candidate workflow script. */
export interface ValidationReport {
  ok: boolean;
  meta?: WorkflowMeta;
  errors: string[];
  warnings: string[];
}

/** Injected globals available inside a workflow script body. */
export interface WorkflowPrimitives {
  agent(prompt: string, opts?: AgentPrimitiveOptions): Promise<unknown>;
  parallel<T>(thunks: Array<Thunk<T>>): Promise<Array<T | null>>;
  pipeline(items: unknown[], ...stages: PipelineStage[]): Promise<unknown[]>;
  phase(title: string): void;
  log(message: unknown): void;
  budget: WorkflowBudget;
  workflow(nameOrRef: string | { scriptPath: string }, args?: unknown): Promise<unknown>;
  validate(source: string): ValidationReport;
}

/** Factory that creates an isolated Agent for one `agent()` dispatch. */
export type WorkflowAgentFactory = (opts?: AgentPrimitiveOptions) => Promise<Agent> | Agent;

/** Mutable run state shared by primitives during one workflow execution. */
export interface WorkflowRunContext {
  cwd: string;
  args: unknown;
  currentPhase: string;
  budgetTotal: number | null;
  tokensSpent: number;
  scheduler: Scheduler;
  sink: EventSink;
  agentFactory: WorkflowAgentFactory;
  baseAgentConfig?: Partial<AgentConfig>;
  signal?: AbortSignal;
}

/** Options for {@link runWorkflow}. */
export interface RunWorkflowOptions {
  /** Run arguments injected as the `args` primitive. */
  args?: unknown;
  /** Working directory for nested workflow resolution. */
  cwd?: string;
  /** Max concurrent agent dispatches (default 4). */
  maxConcurrency?: number;
  /** Max total agent dispatches per run (default 100). */
  maxAgents?: number;
  /** Token budget ceiling; null means unlimited (default null). */
  budget?: number | null;
  /** Custom agent factory; defaults to creating isolated Agents from model config. */
  agentFactory?: WorkflowAgentFactory;
  /** Base Agent config for default factory. */
  agentConfig?: Partial<AgentConfig>;
  /** Model config shorthand for default factory. */
  modelConfig?: AgentModelConfig;
  /** Event sink for progress events. */
  sink?: EventSink;
  /** Abort signal for the run. */
  signal?: AbortSignal;
  /** Script filename used in error messages. */
  filename?: string;
}

/** Result of {@link runWorkflow}. */
export interface WorkflowRunResult {
  result: unknown;
  meta: WorkflowMeta;
  events: WorkflowEvent[];
  tokensSpent: number;
}

/** Options for {@link generateWorkflow}. */
export interface GenerateWorkflowOptions {
  /** Agent config for the authoring agent. */
  agentConfig?: Partial<AgentConfig>;
  modelConfig?: AgentModelConfig;
  /** Custom dialect doc override. */
  dialectDoc?: string;
  /** Custom patterns digest override. */
  patternsDigest?: string;
  /** Max generate/validate/repair attempts (default 3). */
  maxAttempts?: number;
  signal?: AbortSignal;
}

/** Result of {@link generateWorkflow}. */
export interface GenerateWorkflowResult {
  script: string;
  meta: WorkflowMeta;
  attempts: number;
  rationale?: string;
}

/** Loaded workflow script ready for execution. */
export interface LoadedWorkflow {
  meta: WorkflowMeta;
  run(primitives: WorkflowPrimitives, args: unknown): Promise<unknown>;
}

/** Callback after each agent dispatch completes. */
export type AgentRunCallback = (result: AgentResult, opts?: AgentPrimitiveOptions) => void;
