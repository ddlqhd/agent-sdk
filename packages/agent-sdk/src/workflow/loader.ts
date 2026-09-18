/**
 * Workflow loader / transform.
 *
 * Transforms dialect scripts with `export const meta`, top-level await/return,
 * and injected globals into an AsyncFunction wrapper.
 */

import { WorkflowScriptError } from './errors.js';
import type { LoadedWorkflow, WorkflowMeta, WorkflowPrimitives } from './types.js';

const CLAUDE_PARAM_NAMES = [
  'agent',
  'parallel',
  'pipeline',
  'phase',
  'log',
  'args',
  'budget',
  'workflow'
] as const;
const VALIDATE_PARAM = 'validate';
const DECLARES_VALIDATE = /\b(?:const|let|var|function|class)\s+validate\b/;

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...callArgs: unknown[]) => Promise<unknown>;

const EXPORT_META = /\bexport\s+const\s+meta\s*=/;

/** Parse + transform a workflow script's source into a runnable form. */
export function loadWorkflowScript(source: string, filename: string): LoadedWorkflow {
  const { meta, body } = extractMeta(source, filename);
  const injectValidate = !DECLARES_VALIDATE.test(maskNonCode(body));
  const paramNames = injectValidate ? [...CLAUDE_PARAM_NAMES, VALIDATE_PARAM] : [...CLAUDE_PARAM_NAMES];

  let factory: (...callArgs: unknown[]) => Promise<unknown>;
  try {
    factory = new AsyncFunction(...paramNames, `${body}\n//# sourceURL=${filename}`);
  } catch (err) {
    throw new WorkflowScriptError(`failed to compile workflow ${filename}: ${(err as Error).message}`);
  }

  return {
    meta,
    run(primitives: WorkflowPrimitives, args: unknown): Promise<unknown> {
      return factory(
        primitives.agent,
        primitives.parallel,
        primitives.pipeline,
        primitives.phase,
        primitives.log,
        args,
        primitives.budget,
        primitives.workflow,
        primitives.validate
      );
    }
  };
}

/** Scan for APIs that compile but are discouraged in portable workflows. */
export function scanDualCompat(source: string): string[] {
  const masked = maskForDualScan(source);
  const warnings: string[] = [];
  const rules: Array<[RegExp, string]> = [
    [/\bDate\s*\.\s*now\s*\(/, 'Date.now() is discouraged — pass timestamps in via args'],
    [/\bMath\s*\.\s*random\s*\(/, 'Math.random() is discouraged — vary prompts by index instead'],
    [/\bnew\s+Date\s*\(\s*\)/, 'arg-less new Date() is discouraged — pass timestamps in via args']
  ];
  for (const [re, message] of rules) {
    if (re.test(masked)) warnings.push(message);
  }
  return warnings;
}

function maskForDualScan(src: string): string {
  const out = src.split('');
  const n = src.length;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  const scanTemplate = (start: number): number => {
    let i = start;
    let textStart = i;
    while (i < n) {
      const ch = src[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        blank(textStart, i);
        return i + 1;
      }
      if (ch === '$' && src[i + 1] === '{') {
        blank(textStart, i + 2);
        i = scanInterp(i + 2);
        textStart = i;
        continue;
      }
      i++;
    }
    blank(textStart, i);
    return i;
  };

  const scanInterp = (start: number): number => {
    let i = start;
    let depth = 1;
    while (i < n && depth > 0) {
      const ch = src[i];
      const next = src[i + 1];
      if (ch === '/' && next === '/') {
        let j = i + 2;
        while (j < n && src[j] !== '\n') j++;
        blank(i, j);
        i = j;
        continue;
      }
      if (ch === '/' && next === '*') {
        let j = i + 2;
        while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
        j = Math.min(n, j + 2);
        blank(i, j);
        i = j;
        continue;
      }
      if (ch === '"' || ch === "'") {
        i = scanString(i, ch);
        continue;
      }
      if (ch === '`') {
        i = scanTemplate(i + 1);
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    return i;
  };

  const scanString = (start: number, quote: string): number => {
    let j = start + 1;
    let escaped = false;
    while (j < n) {
      const c = src[j];
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) {
        j++;
        break;
      }
      j++;
    }
    blank(start, j);
    return j;
  };

  let i = 0;
  let prevSig = '';
  while (i < n) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(n, j + 2);
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = scanString(i, ch);
      prevSig = ch;
      continue;
    }
    if (ch === '`') {
      i = scanTemplate(i + 1);
      prevSig = '`';
      continue;
    }
    if (ch === '/' && regexAllowed(prevSig)) {
      const j = scanRegex(src, i, n);
      if (j !== null) {
        blank(i, j);
        i = j;
        prevSig = '/';
        continue;
      }
    }
    if (!/\s/.test(ch)) prevSig = ch;
    i++;
  }
  return out.join('');
}

function scanRegex(src: string, start: number, n: number): number | null {
  let j = start + 1;
  let escaped = false;
  let inClass = false;
  while (j < n) {
    const c = src[j]!;
    if (escaped) escaped = false;
    else if (c === '\\') escaped = true;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '\n') return null;
    else if (c === '/' && !inClass) return j + 1;
    j++;
  }
  return null;
}

function extractMeta(source: string, filename: string): { meta: WorkflowMeta; body: string } {
  const masked = maskNonCode(source);
  const match = EXPORT_META.exec(masked);
  if (!match) {
    throw new WorkflowScriptError(`workflow ${filename} must 'export const meta = { ... }'`);
  }
  const exportStart = match.index;
  const exportLen = 'export'.length;
  const braceStart = masked.indexOf('{', exportStart + match[0].length);
  if (braceStart === -1) {
    throw new WorkflowScriptError(`workflow ${filename}: could not find the meta object literal`);
  }
  const end = matchBrace(masked, braceStart);
  if (end === null) {
    throw new WorkflowScriptError(`workflow ${filename}: unterminated meta object literal`);
  }

  const literal = source.slice(braceStart, end + 1);
  let meta: unknown;
  try {
    meta = new Function(`return (${literal});`)();
  } catch (err) {
    throw new WorkflowScriptError(
      `workflow ${filename}: meta must be a literal expression (${(err as Error).message})`
    );
  }
  assertMeta(meta, filename);

  const restMasked =
    masked.slice(0, exportStart) + ' '.repeat(exportLen) + masked.slice(exportStart + exportLen);
  if (/\b(?:export|import)\b/.test(restMasked)) {
    throw new WorkflowScriptError(
      `workflow ${filename}: a workflow body may only 'export const meta'; other top-level ` +
        `export/import statements are not supported (the primitives are injected, not imported)`
    );
  }

  const body = source.slice(0, exportStart) + source.slice(exportStart + exportLen);
  return { meta, body };
}

function matchBrace(masked: string, start: number): number | null {
  let depth = 0;
  for (let i = start; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

function maskNonCode(src: string): string {
  const out = src.split('');
  const n = src.length;
  let prevSig = '';
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  let i = 0;
  while (i < n) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(n, j + 2);
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      let escaped = false;
      while (j < n) {
        const c = src[j]!;
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === ch) {
          j++;
          break;
        }
        j++;
      }
      blank(i, j);
      i = j;
      prevSig = ch;
      continue;
    }
    if (ch === '/' && regexAllowed(prevSig)) {
      let j = i + 1;
      let escaped = false;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const c = src[j]!;
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '\n') break;
        else if (c === '/' && !inClass) {
          j++;
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        blank(i, j);
        i = j;
        prevSig = '/';
        continue;
      }
    }
    if (!/\s/.test(ch)) prevSig = ch;
    i++;
  }
  return out.join('');
}

function regexAllowed(prevSig: string): boolean {
  return prevSig === '' || '([{,;:=!&|?+-*%<>~^'.includes(prevSig);
}

function assertMeta(meta: unknown, filename: string): asserts meta is WorkflowMeta {
  if (meta === null || typeof meta !== 'object') {
    throw new WorkflowScriptError(`workflow ${filename}: meta must be an object`);
  }
  const m = meta as Record<string, unknown>;
  if (typeof m.name !== 'string' || m.name.length === 0) {
    throw new WorkflowScriptError(`workflow ${filename}: meta.name must be a non-empty string`);
  }
  if (typeof m.description !== 'string') {
    throw new WorkflowScriptError(`workflow ${filename}: meta.description must be a string`);
  }
}
