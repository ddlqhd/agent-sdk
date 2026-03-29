import { z } from 'zod';
import { createTool } from '../registry.js';
import type { ToolDefinition } from '../../core/types.js';

interface Task {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

// In-memory task store
const tasks: Map<string, Task> = new Map();
let nextId = 1;

/**
 * TaskCreate 工具 - 创建任务
 */
export const taskCreateTool = createTool({
  name: 'TaskCreate',
  category: 'planning',
  description: `Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.

## When to Use This Tool

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- User explicitly requests todo list - When the user directly asks you to use the task list
- User provides multiple tasks - When users provide a list of things to be done

## When NOT to Use

- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps

All tasks are created with status pending.`,
  parameters: z.object({
    subject: z.string().describe('A brief title for the task'),
    description: z.string().describe('What needs to be done'),
    activeForm: z
      .string()
      .optional()
      .describe('Present continuous form shown in spinner when in_progress (e.g., "Running tests")')
  }),
  handler: async ({ subject, description, activeForm }) => {
    const id = String(nextId++);
    const task: Task = {
      id,
      subject,
      description,
      status: 'pending',
      ...(activeForm && { activeForm })
    };
    tasks.set(id, task);

    return {
      content: `Task created [${id}]: ${subject}`,
      metadata: { task }
    };
  }
});

/**
 * TaskUpdate 工具 - 更新任务
 */
export const taskUpdateTool = createTool({
  name: 'TaskUpdate',
  category: 'planning',
  description: `Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as completed:**
- When you have completed the work described in a task
- IMPORTANT: Always mark your assigned tasks as completed when you finish them

**Delete tasks:**
- When a task is no longer relevant or was created in error

## Status Workflow

Status progresses: pending → in_progress → completed`,
  parameters: z.object({
    taskId: z.string().describe('The ID of the task to update'),
    status: z
      .enum(['pending', 'in_progress', 'completed', 'deleted'])
      .optional()
      .describe('New status for the task'),
    subject: z.string().optional().describe('New subject for the task'),
    description: z.string().optional().describe('New description for the task'),
    activeForm: z
      .string()
      .optional()
      .describe('Present continuous form shown in spinner when in_progress')
  }),
  handler: async ({ taskId, status, subject, description, activeForm }) => {
    const task = tasks.get(taskId);
    if (!task) {
      return {
        content: `Task ${taskId} not found`,
        isError: true
      };
    }

    if (status === 'deleted') {
      tasks.delete(taskId);
      return { content: `Task ${taskId} deleted` };
    }

    if (status) task.status = status;
    if (subject) task.subject = subject;
    if (description) task.description = description;
    if (activeForm) task.activeForm = activeForm;

    const icon = task.status === 'completed' ? 'x' : task.status === 'in_progress' ? '>' : ' ';
    return {
      content: `Task [${taskId}] updated: [${icon}] ${task.subject}`,
      metadata: { task }
    };
  }
});

/**
 * TaskList 工具 - 列出所有任务
 */
export const taskListTool = createTool({
  name: 'TaskList',
  category: 'planning',
  description: `Use this tool to list all tasks in the task list.

## Output

Returns a summary of each task:
- id: Task identifier (use with TaskUpdate)
- subject: Brief description of the task
- status: pending, in_progress, or completed`,
  parameters: z.object({}),
  handler: async () => {
    if (tasks.size === 0) {
      return { content: 'No tasks in the list.' };
    }

    const lines: string[] = [];
    for (const [, task] of tasks) {
      const icon = task.status === 'completed' ? 'x' : task.status === 'in_progress' ? '>' : ' ';
      lines.push(`[${icon}] [${task.id}] ${task.subject}`);
    }

    const pending = [...tasks.values()].filter(t => t.status === 'pending').length;
    const inProgress = [...tasks.values()].filter(t => t.status === 'in_progress').length;
    const completed = [...tasks.values()].filter(t => t.status === 'completed').length;

    return {
      content: `Tasks (${completed} completed, ${inProgress} in progress, ${pending} pending):\n\n${lines.join('\n')}`
    };
  }
});

/**
 * 获取所有 Task 工具
 */
export function getTaskTools(): ToolDefinition[] {
  return [taskCreateTool, taskUpdateTool, taskListTool];
}
