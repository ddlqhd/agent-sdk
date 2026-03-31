import { z } from 'zod';
import { createTool } from '../registry.js';
import type { ToolDefinition, ToolExecutionContext, ToolResult } from '../../core/types.js';

export const subagentRequestSchema = z.object({
  prompt: z.string().min(1).describe('Task prompt for the subagent. Include all required context.'),
  description: z
    .string()
    .optional()
    .describe('Short 3-5 words task label for logs and metadata.'),
  subagent_type: z
    .enum(['general-purpose', 'explore'])
    .default('general-purpose')
    .describe('Subagent profile/type to use.'),
  allowed_tools: z
    .array(z.string().min(1))
    .optional()
    .describe('Optional allowlist of tool names for the subagent.'),
  max_iterations: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Maximum reasoning iterations for the subagent.'),
  timeout_ms: z
    .number()
    .int()
    .min(1000)
    .optional()
    .describe('Timeout for this subagent run in milliseconds.'),
  system_prompt: z
    .string()
    .optional()
    .describe('Optional system prompt appended for the subagent run.')
});

export type SubagentRequest = z.infer<typeof subagentRequestSchema>;

export interface SubagentRunner {
  (request: SubagentRequest, context?: ToolExecutionContext): Promise<ToolResult>;
}

export interface CreateAgentToolOptions {
  runner: SubagentRunner;
}

/**
 * Agent tool - delegates a task to a dedicated subagent run.
 */
export function createAgentTool(options: CreateAgentToolOptions): ToolDefinition {
  return createTool({
    name: 'Agent',
    category: 'planning',
    description: `Launch a new subagent to handle complex, multi-step tasks autonomously.

The Agent tool delegates work to a dedicated subagent that runs in isolated context and returns a final result back to the parent agent.

Use this tool when:
- The task requires broader exploration or multi-step research
- You want to keep the parent context focused and concise
- You need a specific subagent profile (for example, explore vs general-purpose)

When NOT to use this tool:
- Reading a known file path (use Read directly)
- Simple symbol or text lookup (use Grep/Glob directly)
- Small scoped changes in 1-3 files that do not benefit from delegation

Usage notes:
- Always pass a short description and a complete prompt with all required context
- Use subagent_type to select behavior; default is general-purpose
- Subagents do not inherit parent conversation history, only the prompt you provide
- Subagents cannot spawn other subagents (no nested Agent calls)`,
    parameters: subagentRequestSchema,
    handler: async (args, context) => {
      return options.runner(args as SubagentRequest, context);
    }
  });
}

export const agentTool = createAgentTool({
  runner: async () => ({
    content: 'Agent tool runner is not configured in this runtime',
    isError: true
  })
});

export function getSubagentTools(): ToolDefinition[] {
  return [agentTool];
}

