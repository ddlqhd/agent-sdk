import { z } from 'zod';
import { createTool } from '../registry.js';
import type { ToolDefinition } from '../../core/types.js';

/**
 * AskUserQuestion 工具 - 向用户提问
 */
export const questionTool = createTool({
  name: 'AskUserQuestion',
  category: 'interaction',
  description: `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`,
  parameters: z.object({
    questions: z
      .array(
        z.object({
          question: z.string().describe('The complete question to ask the user. Should be clear, specific, and end with a question mark.'),
          header: z.string().describe('Very short label displayed as a chip/tag (max 30 chars).'),
          options: z
            .array(
              z.object({
                label: z.string().describe('The display text for this option. Should be concise (1-5 words).'),
                description: z.string().describe('Explanation of what this option means or what will happen if chosen.')
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
  }),
  handler: async ({ questions }) => {
    const lines: string[] = [];
    for (const q of questions) {
      lines.push(`[${q.header}] ${q.question}\n`);
      q.options.forEach((opt: { label: string; description: string }, i: number) => {
        lines.push(`  ${i + 1}. ${opt.label} — ${opt.description}`);
      });
      if (q.multiSelect) {
        lines.push('\n(Select one or more options)');
      } else {
        lines.push('\n(Select one option)');
      }
      lines.push('');
    }

    return {
      content: lines.join('\n'),
      metadata: { questions }
    };
  }
});

/**
 * 获取 Interaction 工具
 */
export function getInteractionTools(): ToolDefinition[] {
  return [questionTool];
}
