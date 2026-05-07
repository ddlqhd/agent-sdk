import { z } from 'zod';
import { createTool } from '../registry.js';
import type { ToolDefinition, ToolExecutionContext, ToolResult } from '../../core/types.js';
import {
  buildAgentToolDescription,
  getDefaultBuiltinProfileMap,
  profilesMapToSortedList
} from '../../subagents/index.js';

export type { SubagentType } from './subagent-profiles.js';
export { resolveSubagentTypeAppend } from './subagent-profiles.js';

export const subagentRequestSchema = z.object({
  prompt: z.string().min(1).describe('Task prompt for the subagent. Include all required context.'),
  description: z
    .string()
    .optional()
    .describe('Short 3-5 words task label for logs and metadata.'),
  subagent_type: z
    .string()
    .min(1)
    .default('general-purpose')
    .describe('Subagent profile name from the Agent tool description (e.g. general-purpose, explore, or a custom profile).'),
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
  /** Full tool description shown to the model (include available subagent list). */
  description?: string;
}

const defaultAgentToolDescription = buildAgentToolDescription(
  profilesMapToSortedList(getDefaultBuiltinProfileMap())
);

/**
 * Agent tool - delegates a task to a dedicated subagent run.
 */
export function createAgentTool(options: CreateAgentToolOptions): ToolDefinition {
  return createTool({
    name: 'Agent',
    category: 'planning',
    description: options.description ?? defaultAgentToolDescription,
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
  }),
  description: defaultAgentToolDescription
});

export function getSubagentTools(): ToolDefinition[] {
  return [agentTool];
}
