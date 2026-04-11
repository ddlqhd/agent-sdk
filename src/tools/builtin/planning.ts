import { z } from 'zod';
import { createTool } from '../registry.js';
import type { ToolDefinition } from '../../core/types.js';

const todoStatusEnum = z.enum(['pending', 'in_progress', 'completed']);

/**
 * TodoWrite 工具 - 批量写入任务列表
 */
export const todoWriteTool = createTool({
  name: 'TodoWrite',
  category: 'planning',
  description: `MUST USE for multi-step tasks. Creates a structured task list to track progress. Call this tool FIRST before executing any complex task.

Any number of tasks may be "in_progress" when work runs in parallel. Zero in_progress is fine (e.g. all pending or all completed).

**Before you finish your assistant response for a multi-step request**, call \`TodoWrite\` again so **every** item in the list has status \`completed\`, unless you are explicitly pausing mid-work for a follow-up turn. Do not leave dangling \`pending\` or \`in_progress\` items when the work for this request is done.

**Replanning:** If execution shows the earlier plan was wrong, incomplete, or no longer fits (wrong order, missing steps, obsolete items), call \`TodoWrite\` anytime with an updated full list—add, remove, merge, or rewrite steps as needed.

Triggers: multi-step tasks, multiple files/components, user provides task list.
Skip: single simple task, informational questions.`,
  parameters: z.object({
    todos: z
      .array(
        z.object({
          content: z
            .string()
            .describe('Brief description of the task in imperative form (e.g., "Run tests")'),
          activeForm: z
            .string()
            .optional()
            .describe(
              'Optional present-continuous label for in-progress UI (e.g., "Running tests"). Omit if not needed.'
            ),
          status: todoStatusEnum.describe('Task status: pending, in_progress, or completed')
        })
      )
      .min(1)
      .describe(
        'Full updated todo list. Refresh this whenever progress or the plan changes. When finishing the multi-step work, all entries should be completed.'
      )
  }),
  handler: async ({ todos }: {
    todos: Array<{
      content: string;
      activeForm?: string;
      status: z.infer<typeof todoStatusEnum>;
    }>;
  }) => {
    const lines: string[] = [];
    for (const todo of todos) {
      const icon = todo.status === 'completed' ? 'x' : todo.status === 'in_progress' ? '>' : ' ';
      lines.push(`[${icon}] ${todo.content}`);
    }

    const pending = todos.filter((todo) => todo.status === 'pending').length;
    const inProgress = todos.filter((todo) => todo.status === 'in_progress').length;
    const completed = todos.filter((todo) => todo.status === 'completed').length;

    return {
      content: `Task list updated (${completed} completed, ${inProgress} in progress, ${pending} pending):\n\n${lines.join('\n')}`,
      metadata: { todos }
    };
  }
});

/**
 * 获取所有 Planning 工具
 */
export function getPlanningTools(): ToolDefinition[] {
  return [todoWriteTool];
}
