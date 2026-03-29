import { createInterface } from 'node:readline/promises';
import { z } from 'zod';
import { createTool } from '../registry.js';
import type { ToolDefinition } from '../../core/types.js';

const questionsSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z
          .string()
          .describe(
            'The complete question to ask the user. Should be clear, specific, and end with a question mark.'
          ),
        header: z.string().describe('Very short label displayed as a chip/tag (max 30 chars).'),
        options: z
          .array(
            z.object({
              label: z.string().describe('The display text for this option. Should be concise (1-5 words).'),
              description: z
                .string()
                .describe('Explanation of what this option means or what will happen if chosen.')
            })
          )
          .min(2)
          .max(4)
          .describe('The available choices for this question. Must have 2-4 options.'),
        multiSelect: z
          .boolean()
          .default(false)
          .describe('Set to true to allow the user to select multiple options.')
      })
    )
    .min(1)
    .max(4)
    .describe('Questions to ask the user (1-4 questions)')
});

export type AskUserQuestionItem = z.infer<typeof questionsSchema>['questions'][number];

export type AskUserQuestionAnswer = {
  questionIndex: number;
  selectedLabels: string[];
  otherText?: string;
};

const MAX_PROMPT_RETRIES = 10;

/**
 * Format questions for display (non-TTY result body and TTY preamble).
 */
export function formatAskUserQuestionPrompt(questions: AskUserQuestionItem[]): string {
  const lines: string[] = [];
  for (const q of questions) {
    lines.push(`[${q.header}] ${q.question}\n`);
    q.options.forEach((opt, i) => {
      lines.push(`  ${i + 1}. ${opt.label} — ${opt.description}`);
    });
    if (q.multiSelect) {
      lines.push('\n(Select one or more options)');
    } else {
      lines.push('\n(Select one option)');
    }
    lines.push('');
  }
  return lines.join('\n');
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

function formatAnswerSummary(questions: AskUserQuestionItem[], answers: AskUserQuestionAnswer[]): string {
  const lines: string[] = ['', '--- User responses ---'];
  for (const a of answers) {
    const q = questions[a.questionIndex];
    if (a.otherText !== undefined) {
      lines.push(
        `[${q.header}] Other: ${a.otherText.trim() === '' ? '(empty)' : a.otherText}`
      );
    } else if (a.selectedLabels.length > 0) {
      lines.push(`[${q.header}] ${a.selectedLabels.join(', ')}`);
    } else {
      lines.push(`[${q.header}] (no selection)`);
    }
  }
  return lines.join('\n');
}

/**
 * Collect answers via readLine (TTY or injected for tests).
 */
export async function runInteractiveAskUserQuestion(
  questions: AskUserQuestionItem[],
  readLine: (prompt: string) => Promise<string>
): Promise<AskUserQuestionAnswer[]> {
  const answers: AskUserQuestionAnswer[] = [];

  for (let qi = 0; qi < questions.length; qi++) {
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
      attempt++;
      process.stdout.write(block + '\n');
      const line = await readLine('> ');
      const parsed = q.multiSelect ? parseMultiLine(line, n) : parseSingleLine(line, n);

      if (!parsed) {
        process.stdout.write(
          `Invalid input. ${q.multiSelect ? 'Use numbers 1-' + n + ' (comma/space separated)' : 'Enter 1-' + n}, or 0/o for Other.\n`
        );
        continue;
      }

      if (parsed.kind === 'other') {
        const otherText = (await readLine('Other (custom text): ')).trim();
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

/**
 * Single readline session for the whole questionnaire; must be closed after use.
 * Temporarily turns off raw mode when needed so readline behaves correctly (TTY only).
 * Hosts that use their own raw stdin (e.g. CLI ESC listener) should release raw mode
 * before the tool runs; this is a generic fallback for other integrators.
 */
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

export interface CreateAskUserQuestionToolOptions {
  /** When set, used instead of TTY stdin (e.g. tests). When unset and stdin is TTY, uses readline. */
  readLine?: (prompt: string) => Promise<string>;
}

/**
 * AskUserQuestion 工具 - 向用户提问（TTY 下阻塞读入；非 TTY 仅返回排版文本）
 */
export function createAskUserQuestionTool(options?: CreateAskUserQuestionToolOptions): ToolDefinition {
  const customReadLine = options?.readLine;

  return createTool({
    name: 'AskUserQuestion',
    category: 'interaction',
    description: `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Environment:
- In an interactive terminal (TTY), the tool waits for the user to enter choices before returning.
- In non-interactive environments (pipes, CI), the tool returns only the question text without blocking.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`,
    parameters: questionsSchema,
    handler: async ({ questions }) => {
      const promptText = formatAskUserQuestionPrompt(questions);

      if (!customReadLine && !process.stdin.isTTY) {
        return {
          content: promptText,
          metadata: { questions }
        };
      }

      const session = customReadLine
        ? null
        : createTtyReadLineSession();
      const readLine = customReadLine ?? session!.readLine;

      try {
        const answers = await runInteractiveAskUserQuestion(questions, readLine);
        const summary = formatAnswerSummary(questions, answers);
        return {
          content: promptText + summary,
          metadata: { questions, answers }
        };
      } finally {
        session?.close();
      }
    }
  });
}

export const questionTool = createAskUserQuestionTool();

/**
 * 获取 Interaction 工具
 */
export function getInteractionTools(): ToolDefinition[] {
  return [questionTool];
}
