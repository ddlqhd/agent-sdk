import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Agent } from '../core/agent.js';
import { createModel } from '../models/index.js';
import type { AgentConfig } from '../core/types.js';
import { tokensFromAgentResult } from './budget.js';
import {
  AGENT_FAILED,
  AGENT_FINISHED,
  AGENT_STARTED,
  LOG,
  PHASE_STARTED,
  event
} from './events.js';
import { isFatalError, SchemaValidationError, WorkflowScriptError } from './errors.js';
import { loadWorkflowScript, scanDualCompat } from './loader.js';
import { extractJsonFromText, formatSchemaInstruction } from './schema-helper.js';
import type {
  AgentPrimitiveOptions,
  ValidationReport,
  WorkflowBudget,
  WorkflowPrimitives,
  WorkflowRunContext
} from './types.js';

const WORKFLOW_AGENT_PREFIX =
  'You are one agent in an automated multi-agent workflow. Work independently ' +
  'on the task below. Do not ask clarifying questions and do not assume other ' +
  'agents exist. Produce your result directly.\n\n';

interface CreatePrimitivesInternal {
  depth?: number;
  phasePrefix?: string;
}

/** Build the injected primitive set bound to a single run's context. */
export function createPrimitives(
  ctx: WorkflowRunContext,
  internal: CreatePrimitivesInternal = {}
): WorkflowPrimitives {
  const depth = internal.depth ?? 0;
  const phasePrefix = internal.phasePrefix ?? '';

  const agent = async (prompt: string, opts: AgentPrimitiveOptions = {}): Promise<unknown> => {
    const activePhase = opts.phase !== undefined ? opts.phase : ctx.currentPhase;
    const display = opts.label ?? 'agent';
    const schemaRetries = opts.schemaRetries ?? 2;
    const maxAttempts = opts.schema ? schemaRetries + 1 : 1;

    try {
      return await ctx.scheduler.runAgent(async () => {
        ctx.sink.emit(
          event(AGENT_STARTED, {
            label: display,
            phase: activePhase
          })
        );

        let lastError = '';
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const composedPrompt = buildAgentPrompt(prompt, opts, lastError);
          const child = await ctx.agentFactory(opts);
          await child.waitForInit();

          const result = await child.run(composedPrompt, { signal: ctx.signal });
          const tokens = tokensFromAgentResult(result.usage);
          ctx.tokensSpent += tokens;

          if (!opts.schema) {
            ctx.sink.emit(
              event(AGENT_FINISHED, {
                label: display,
                phase: activePhase,
                attempts: attempt,
                tokens
              })
            );
            return result.content;
          }

          const parsed = extractJsonFromText(result.content);
          if (parsed === undefined) {
            lastError = 'no JSON value found in the reply';
          } else {
            const check = opts.schema.safeParse(parsed);
            if (check.success) {
              ctx.sink.emit(
                event(AGENT_FINISHED, {
                  label: display,
                  phase: activePhase,
                  attempts: attempt,
                  tokens
                })
              );
              return check.data;
            }
            lastError = check.error.issues.map((i) => i.message).join('; ');
          }

          if (attempt >= maxAttempts) {
            throw new SchemaValidationError(
              `agent '${display}' did not satisfy schema after ${maxAttempts} attempt(s): ${lastError}`
            );
          }
        }

        throw new SchemaValidationError(`agent '${display}' failed unexpectedly`);
      });
    } catch (err) {
      if (isFatalError(err)) throw err;
      ctx.sink.emit(
        event(AGENT_FAILED, {
          label: display,
          phase: activePhase,
          error: err instanceof Error ? err.message : String(err)
        })
      );
      throw err;
    }
  };

  const parallel = <T>(thunks: Array<() => Promise<T> | T>): Promise<Array<T | null>> =>
    ctx.scheduler.gather(thunks.map((t) => async () => t()));

  const pipeline = (items: unknown[], ...stages: Array<(previous: unknown, item: unknown, index: number) => unknown>): Promise<unknown[]> => {
    const chains = items.map((item, index) => async (): Promise<unknown> => {
      let value: unknown = item;
      for (const stage of stages) {
        value = await stage(value, item, index);
      }
      return value;
    });
    return ctx.scheduler.gather(chains) as Promise<unknown[]>;
  };

  const phase = (title: string): void => {
    const labelled = phasePrefix + title;
    ctx.currentPhase = labelled;
    ctx.sink.emit(event(PHASE_STARTED, { phase: labelled }));
  };

  const log = (message: unknown): void => {
    ctx.sink.emit(event(LOG, { message: String(message) }));
  };

  const budget: WorkflowBudget = {
    total: ctx.budgetTotal,
    spent: () => ctx.tokensSpent,
    remaining: () =>
      ctx.budgetTotal === null ? Infinity : Math.max(0, ctx.budgetTotal - ctx.tokensSpent)
  };

  const workflow = async (
    nameOrRef: string | { scriptPath: string },
    childArgs?: unknown
  ): Promise<unknown> => {
    if (depth >= 1) {
      throw new WorkflowScriptError(
        'workflow() inside a child workflow is not supported — nesting is one level deep'
      );
    }

    let scriptPath: string;
    if (typeof nameOrRef === 'string') {
      scriptPath = resolve(ctx.cwd, nameOrRef.endsWith('.js') ? nameOrRef : `${nameOrRef}.js`);
    } else if (nameOrRef && typeof nameOrRef.scriptPath === 'string') {
      scriptPath = resolve(ctx.cwd, nameOrRef.scriptPath);
    } else {
      throw new WorkflowScriptError('workflow() expects a name or { scriptPath }');
    }

    let text: string;
    try {
      text = readFileSync(scriptPath, 'utf8');
    } catch (err) {
      throw new WorkflowScriptError(
        `workflow(): cannot read ${scriptPath}: ${(err as Error).message}`
      );
    }

    const loaded = loadWorkflowScript(text, scriptPath);
    const name = loaded.meta.name;
    const entryLane = `▸ ${name}`;
    const childCtx: WorkflowRunContext = {
      ...ctx,
      currentPhase: entryLane
    };
    const childGlobals = createPrimitives(childCtx, {
      depth: depth + 1,
      phasePrefix: `▸ ${name} · `
    });

    ctx.sink.emit(event(LOG, { message: `▸ entering workflow ${name} (${scriptPath})` }));
    ctx.sink.emit(event(PHASE_STARTED, { phase: entryLane }));
    const result = await loaded.run(childGlobals, childArgs ?? null);
    ctx.sink.emit(event(LOG, { message: `▸ workflow ${name} returned` }));
    return result;
  };

  const validate = (source: string): ValidationReport => {
    if (typeof source !== 'string') {
      return { ok: false, errors: ['validate() expects a string of workflow source'], warnings: [] };
    }
    try {
      const loaded = loadWorkflowScript(source, 'candidate.js');
      return { ok: true, meta: loaded.meta, errors: [], warnings: scanDualCompat(source) };
    } catch (err) {
      return { ok: false, errors: [(err as Error).message], warnings: [] };
    }
  };

  return { agent, parallel, pipeline, phase, log, budget, workflow, validate };
}

function buildAgentPrompt(prompt: string, opts: AgentPrimitiveOptions, schemaError: string): string {
  const parts = [WORKFLOW_AGENT_PREFIX + prompt.trim()];
  if (opts.schema) {
    parts.push(formatSchemaInstruction(opts.schema));
  }
  if (schemaError) {
    parts.push(
      'Your previous reply did not satisfy the required schema:\n' +
        schemaError +
        '\nReturn corrected JSON only, with no surrounding text.'
    );
  }
  return parts.join('\n\n');
}

/** Default factory: create an isolated Agent per dispatch from base config. */
export function createDefaultAgentFactory(baseConfig: Partial<AgentConfig> = {}) {
  return async (opts?: AgentPrimitiveOptions): Promise<Agent> => {
    const config: AgentConfig = {
      ...baseConfig,
      loadSkills: baseConfig.loadSkills ?? false,
      subagent: {
        ...baseConfig.subagent,
        enabled: false
      }
    };

    if (opts?.model && baseConfig.modelConfig) {
      config.modelConfig = {
        ...baseConfig.modelConfig,
        model: opts.model
      };
      config.model = undefined;
    } else if (opts?.model && baseConfig.model) {
      config.model = createModel({
        provider: inferProviderFromAdapter(baseConfig.model),
        model: opts.model
      });
    }

    if (opts?.systemPrompt) {
      config.systemPrompt = opts.systemPrompt;
    }

    const agent = new Agent(config);
    return agent;
  };
}

function inferProviderFromAdapter(model: AgentConfig['model']): 'openai' | 'anthropic' | 'ollama' {
  const name = model?.name?.toLowerCase() ?? '';
  if (name.includes('claude') || name.includes('anthropic')) return 'anthropic';
  if (name.includes('ollama') || name.includes('llama')) return 'ollama';
  return 'openai';
}
