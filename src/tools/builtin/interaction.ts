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

/**
 * 可选；与 `ToolExecutionContext.signal` 一致，用于在宿主侧取消等待（如 TTY 读入、Web 弹窗）。
 */
export interface AskUserQuestionResolverOptions {
  signal?: AbortSignal;
}

/**
 * Host-provided implementation: CLI (TTY), web UI (WebSocket), tests, etc.
 */
export type AskUserQuestionResolver = (
  questions: AskUserQuestionItem[],
  options?: AskUserQuestionResolverOptions
) => Promise<AskUserQuestionAnswer[]>;

/**
 * Format questions for display (static fallback body).
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

export function formatAnswerSummary(questions: AskUserQuestionItem[], answers: AskUserQuestionAnswer[]): string {
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

export interface CreateAskUserQuestionToolOptions {
  /**
   * When set, collects answers interactively. When omitted, the tool returns only formatted questions (non-blocking).
   */
  resolve?: AskUserQuestionResolver;
}

/**
 * AskUserQuestion — interactive behavior is entirely determined by {@link CreateAskUserQuestionToolOptions.resolve}.
 */
export function createAskUserQuestionTool(options?: CreateAskUserQuestionToolOptions): ToolDefinition {
  const resolve = options?.resolve;

  return createTool({
    name: 'AskUserQuestion',
    category: 'interaction',
    description: `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

The host application must provide a resolver that collects answers; without it, only the question text is returned.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`,
    parameters: questionsSchema,
    handler: async ({ questions }, context) => {
      const promptText = formatAskUserQuestionPrompt(questions);

      if (!resolve) {
        return {
          content: promptText,
          metadata: { questions }
        };
      }

      if (context?.signal?.aborted) {
        return {
          content: 'AskUserQuestion was aborted before user input could be collected.',
          isError: true,
          metadata: { questions }
        };
      }

      let answers: AskUserQuestionAnswer[];
      try {
        answers = await resolve(questions, { signal: context?.signal });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: `AskUserQuestion failed: ${msg}`,
          isError: true,
          metadata: { questions }
        };
      }

      const summary = formatAnswerSummary(questions, answers);
      return {
        content: promptText + summary,
        metadata: { questions, answers }
      };
    }
  });
}

export const questionTool = createAskUserQuestionTool();

/**
 * Interaction tools (AskUserQuestion).
 */
export function getInteractionTools(options?: CreateAskUserQuestionToolOptions): ToolDefinition[] {
  return [createAskUserQuestionTool(options)];
}
