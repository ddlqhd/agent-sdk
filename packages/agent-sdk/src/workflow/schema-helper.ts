import { z } from 'zod';
import type { ZodType } from 'zod';

/** Instruction text telling an agent to reply with matching JSON only. */
export function formatSchemaInstruction(schema: ZodType): string {
  const jsonSchema = z.toJSONSchema(schema);
  const pretty = JSON.stringify(jsonSchema, null, 2);
  return (
    'Respond with a single JSON value and nothing else — no prose, no code ' +
    'fence, no explanation. It must conform to this JSON Schema:\n' +
    pretty
  );
}

/** Best-effort recovery of a JSON value from a free-text agent reply. */
export function extractJsonFromText(text: string): unknown {
  for (const candidate of candidates(text)) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return undefined;
}

function* candidates(text: string): Generator<string> {
  const stripped = text.trim();
  yield* fencedBlocks(stripped);
  const span = balancedSpan(stripped);
  if (span !== null) yield span;
  yield stripped;
}

function* fencedBlocks(text: string): Generator<string> {
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

function balancedSpan(text: string): string | null {
  const startObj = text.indexOf('{');
  const startArr = text.indexOf('[');
  let start: number;
  let open: string;
  let close: string;
  if (startObj === -1 && startArr === -1) return null;
  if (startArr === -1 || (startObj !== -1 && startObj < startArr)) {
    start = startObj;
    open = '{';
    close = '}';
  } else {
    start = startArr;
    open = '[';
    close = ']';
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
