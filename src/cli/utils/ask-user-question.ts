import { createInterface } from 'node:readline/promises';
import { TOOL_USER_ABORTED_MESSAGE } from '../../core/abort-constants.js';
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionResolver
} from '../../tools/builtin/interaction.js';

const MAX_PROMPT_RETRIES = 10;

function readLineWithAbort(
  readLine: (prompt: string) => Promise<string>,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException(TOOL_USER_ABORTED_MESSAGE, 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException(TOOL_USER_ABORTED_MESSAGE, 'AbortError'));
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    void readLine(prompt).then(
      (line) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(line);
      },
      (err) => {
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

function parseSingleLine(
  line: string,
  optionCount: number
): { kind: 'indices'; indices: number[] } | { kind: 'other' } | null {
  const t = line.trim().toLowerCase();
  if (t === '0' || t === 'o') {
    return { kind: 'other' };
  }
  const n = parseInt(t, 10);
  if (!Number.isFinite(n) || n < 1 || n > optionCount) {
    return null;
  }
  return { kind: 'indices', indices: [n - 1] };
}

function parseMultiLine(
  line: string,
  optionCount: number
): { kind: 'indices'; indices: number[] } | { kind: 'other' } | null {
  const t = line.trim().toLowerCase();
  if (t === '0' || t === 'o') {
    return { kind: 'other' };
  }
  const parts = t.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const indices = new Set<number>();
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (!Number.isFinite(n) || n < 1 || n > optionCount) {
      return null;
    }
    indices.add(n - 1);
  }
  if (indices.size === 0) {
    return null;
  }
  return { kind: 'indices', indices: [...indices] };
}

export type RunInteractiveAskUserQuestionOptions = {
  signal?: AbortSignal;
};

/**
 * Collect answers via readLine (TTY or injected for tests).
 */
export async function runInteractiveAskUserQuestion(
  questions: AskUserQuestionItem[],
  readLine: (prompt: string) => Promise<string>,
  options?: RunInteractiveAskUserQuestionOptions
): Promise<AskUserQuestionAnswer[]> {
  const { signal } = options ?? {};
  const answers: AskUserQuestionAnswer[] = [];

  for (let qi = 0; qi < questions.length; qi++) {
    if (signal?.aborted) {
      throw new DOMException(TOOL_USER_ABORTED_MESSAGE, 'AbortError');
    }
    const q = questions[qi];
    const n = q.options.length;
    let attempt = 0;
    let resolved: AskUserQuestionAnswer | null = null;

    const block = [
      `[${q.header}] ${q.question}`,
      ...q.options.map((opt, i) => `  ${i + 1}. ${opt.label} — ${opt.description}`),
      '  0. Other — custom answer when chosen',
      '',
      q.multiSelect
        ? 'Enter one or more numbers (1-' +
          n +
          ') separated by comma or space, or 0/o for Other:'
        : 'Enter a number 1-' + n + ', or 0/o for Other:'
    ].join('\n');

    while (attempt < MAX_PROMPT_RETRIES && !resolved) {
      if (signal?.aborted) {
        throw new DOMException(TOOL_USER_ABORTED_MESSAGE, 'AbortError');
      }
      attempt++;
      process.stdout.write(block + '\n');
      const line = await readLineWithAbort(readLine, '> ', signal);
      const parsed = q.multiSelect ? parseMultiLine(line, n) : parseSingleLine(line, n);

      if (!parsed) {
        process.stdout.write(
          `Invalid input. ${q.multiSelect ? 'Use numbers 1-' + n + ' (comma/space separated)' : 'Enter 1-' + n}, or 0/o for Other.\n`
        );
        continue;
      }

      if (parsed.kind === 'other') {
        const otherText = (
          await readLineWithAbort(readLine, 'Other (custom text): ', signal)
        ).trim();
        resolved = {
          questionIndex: qi,
          selectedLabels: [],
          otherText
        };
        break;
      }

      const labels = parsed.indices.map((idx) => q.options[idx]!.label);
      resolved = {
        questionIndex: qi,
        selectedLabels: labels
      };
      break;
    }

    if (!resolved) {
      resolved = {
        questionIndex: qi,
        selectedLabels: [],
        otherText: '(skipped after invalid input)'
      };
    }

    answers.push(resolved);
  }

  return answers;
}

function createTtyReadLineSession(): {
  readLine: (prompt: string) => Promise<string>;
  close: () => void;
} {
  const stdin = process.stdin;
  const ttyIn = stdin.isTTY ? (stdin as NodeJS.ReadStream & { isRaw?: boolean }) : null;
  const wasRaw = Boolean(ttyIn?.isRaw);
  if (wasRaw) {
    try {
      stdin.setRawMode(false);
    } catch {
      // ignore
    }
  }
  if (stdin.isPaused()) {
    stdin.resume();
  }

  const rl = createInterface({ input: stdin, output: process.stdout });
  return {
    readLine: (prompt: string) => rl.question(prompt),
    close: () => {
      rl.close();
      if (wasRaw && stdin.isTTY) {
        try {
          stdin.setRawMode(true);
        } catch {
          // ignore
        }
      }
    }
  };
}

/**
 * TTY stdin: interactive AskUserQuestion for {@link Agent} `askUserQuestion`.
 * When `options.signal` aborts, the readline interface is closed so a pending
 * `rl.question` does not block shutdown (pairs with host `StreamOptions.signal`).
 */
export function createTtyAskUserQuestionResolver(): AskUserQuestionResolver {
  return async (questions, options) => {
    const session = createTtyReadLineSession();
    const { signal } = options ?? {};
    const onAbort = () => {
      try {
        session.close();
      } catch {
        // ignore
      }
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        throw new DOMException(TOOL_USER_ABORTED_MESSAGE, 'AbortError');
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      return await runInteractiveAskUserQuestion(questions, session.readLine, options);
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      session.close();
    }
  };
}
