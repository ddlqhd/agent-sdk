import { z } from 'zod';
import { extractJsonFromText } from './schema-helper.js';

export const scriptOutputSchema = z.object({
  script: z.string().min(1).describe('The complete workflow script source, dialect-correct.'),
  rationale: z.string().optional().describe('One short line on the orchestration shape chosen.')
});

export type ScriptDraft = z.infer<typeof scriptOutputSchema>;

const EXPORT_META = /^\s*export\s+const\s+meta\s*=/;

/** Parse an authoring agent reply into a script draft. */
export function parseScriptDraft(content: string): { draft?: ScriptDraft; error?: string } {
  const trimmed = content.trim();
  if (!trimmed) {
    return { error: 'empty response' };
  }

  const fromJson = parseJsonDraft(trimmed);
  if (fromJson.draft) return fromJson;
  if (fromJson.error && fromJson.error !== 'not json') {
    return fromJson;
  }

  const fromScript = parseRawWorkflowScript(trimmed);
  if (fromScript.draft) return fromScript;

  return {
    error: fromJson.error ?? fromScript.error ?? 'could not parse script draft from response'
  };
}

function parseJsonDraft(text: string): { draft?: ScriptDraft; error?: string } {
  const parsed = extractJsonFromText(text);
  if (parsed === undefined) {
    return { error: 'not json' };
  }

  const check = scriptOutputSchema.safeParse(parsed);
  if (check.success) {
    return { draft: check.data };
  }

  return {
    error: check.error.issues.map((i) => i.message).join('; ')
  };
}

function parseRawWorkflowScript(text: string): { draft?: ScriptDraft; error?: string } {
  const candidates = [text, ...extractFencedBlocks(text)];
  for (const candidate of candidates) {
    const body = candidate.trim();
    if (!EXPORT_META.test(body)) continue;
    const report = tryValidateWorkflowShape(body);
    if (report.ok) {
      return { draft: { script: body } };
    }
  }
  return { error: 'response is not JSON and does not look like a workflow script' };
}

function* extractFencedBlocks(text: string): Generator<string> {
  let from = 0;
  for (;;) {
    const fence = text.indexOf('```', from);
    if (fence === -1) return;
    const after = text.slice(fence + 3);
    const langEnd = after.indexOf('\n');
    if (langEnd === -1) return;
    const close = after.indexOf('```', langEnd + 1);
    if (close === -1) return;
    yield after.slice(langEnd + 1, close).trim();
    from = fence + 3 + close + 3;
  }
}

function tryValidateWorkflowShape(source: string): { ok: boolean } {
  try {
    const match = EXPORT_META.exec(source);
    if (!match) return { ok: false };
    const braceStart = source.indexOf('{', match.index);
    if (braceStart === -1) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
