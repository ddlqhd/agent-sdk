import { Agent } from '../core/agent.js';
import { DIALECT_DOC, PATTERNS_DIGEST, WORKFLOW_HARD_RULES } from './dialect-doc.js';
import { loadWorkflowScript, scanDualCompat } from './loader.js';
import { parseScriptDraft, scriptOutputSchema, type ScriptDraft } from './parse-script-draft.js';
import { formatSchemaInstruction } from './schema-helper.js';
import type { GenerateWorkflowOptions, GenerateWorkflowResult, ValidationReport } from './types.js';

const AUTHORING_SYSTEM_PROMPT =
  'You author dynamic workflow scripts. When asked, respond with JSON only — no prose, ' +
  'no markdown fences around the JSON object. Put the complete workflow file in the "script" string ' +
  'with escaped newlines as required by JSON.';

const JSON_OUTPUT_INSTRUCTION = formatSchemaInstruction(scriptOutputSchema);

/**
 * Generate a workflow script from a natural-language task description.
 * Runs generate → validate → repair (up to maxAttempts).
 */
export async function generateWorkflow(
  task: string,
  options: GenerateWorkflowOptions = {}
): Promise<GenerateWorkflowResult> {
  const trimmed = task.trim();
  if (!trimmed) {
    throw new Error('generateWorkflow requires a non-empty task description');
  }

  const maxAttempts = options.maxAttempts ?? 3;
  const dialectDoc = options.dialectDoc ?? DIALECT_DOC;
  const patternsDigest = options.patternsDigest ?? PATTERNS_DIGEST;

  const agent = new Agent({
    ...options.agentConfig,
    systemPrompt: options.agentConfig?.systemPrompt ?? AUTHORING_SYSTEM_PROMPT,
    modelConfig: options.modelConfig ?? options.agentConfig?.modelConfig,
    loadSkills: false,
    subagent: { enabled: false }
  });
  await agent.waitForInit();

  const authoringPrompt =
    'Write ONE dynamic-workflow script for the task below.\n\n' +
    '== Dialect documentation ==\n' +
    dialectDoc +
    '\n\n== Patterns ==\n' +
    patternsDigest +
    '\n\n== Task ==\n' +
    trimmed +
    '\n\n== Hard rules ==\n- ' +
    WORKFLOW_HARD_RULES +
    '\n\n' +
    JSON_OUTPUT_INSTRUCTION;

  let draft = await runAuthoringAgent(agent, authoringPrompt, options.signal);
  let lastProblems: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const check = validateWorkflowSource(draft.script);
    const problems = check.ok ? check.warnings : check.errors;

    if (check.ok && check.warnings.length === 0 && check.meta) {
      return {
        script: draft.script,
        meta: check.meta,
        attempts: attempt,
        rationale: draft.rationale
      };
    }

    if (check.ok && check.warnings.length === 0 && !check.meta) {
      throw new Error('validated script missing meta');
    }

    if (check.ok && check.meta && check.warnings.length > 0 && attempt === maxAttempts) {
      return {
        script: draft.script,
        meta: check.meta,
        attempts: attempt,
        rationale: draft.rationale
      };
    }

    lastProblems = problems;
    if (attempt === maxAttempts) break;

    const repairPrompt =
      'Your previous workflow script failed validation. Fix it and return the COMPLETE corrected script.\n\n' +
      '== Validation problems ==\n- ' +
      problems.join('\n- ') +
      '\n\n== Previous script ==\n' +
      draft.script +
      '\n\n== Hard rules (re-read carefully) ==\n- ' +
      WORKFLOW_HARD_RULES +
      '\n\n' +
      JSON_OUTPUT_INSTRUCTION;

    draft = await runAuthoringAgent(agent, repairPrompt, options.signal);
  }

  throw new Error(`script did not validate after ${maxAttempts} attempts: ${lastProblems.join('; ')}`);
}

/** Compile-check a workflow source without executing it. */
export function validateWorkflowSource(source: string): ValidationReport {
  if (typeof source !== 'string') {
    return { ok: false, errors: ['validate expects a string of workflow source'], warnings: [] };
  }
  try {
    const loaded = loadWorkflowScript(source, 'candidate.js');
    return { ok: true, meta: loaded.meta, errors: [], warnings: scanDualCompat(source) };
  } catch (err) {
    return { ok: false, errors: [(err as Error).message], warnings: [] };
  }
}

async function runAuthoringAgent(
  agent: Agent,
  prompt: string,
  signal?: AbortSignal
): Promise<ScriptDraft> {
  const maxParseAttempts = 3;
  let lastError = '';
  let lastContent = '';

  for (let attempt = 1; attempt <= maxParseAttempts; attempt++) {
    const userPrompt =
      attempt === 1
        ? prompt
        : 'Your previous reply could not be parsed.\n\n' +
          '== Parse error ==\n' +
          lastError +
          '\n\n== Previous reply (truncated) ==\n' +
          truncateForPrompt(lastContent, 4000) +
          '\n\nReturn ONLY valid JSON matching the schema. Do not wrap the JSON in markdown fences.\n\n' +
          JSON_OUTPUT_INSTRUCTION;

    const result = await agent.run(userPrompt, { signal });
    lastContent = result.content;
    const parsed = parseScriptDraft(result.content);

    if (parsed.draft) {
      return parsed.draft;
    }

    lastError = parsed.error ?? 'unknown parse error';
    if (attempt >= maxParseAttempts) {
      throw new Error(
        `authoring agent did not return a parseable script draft after ${maxParseAttempts} attempt(s): ${lastError}`
      );
    }
  }

  throw new Error('authoring agent failed unexpectedly');
}

function truncateForPrompt(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n... [truncated]';
}
