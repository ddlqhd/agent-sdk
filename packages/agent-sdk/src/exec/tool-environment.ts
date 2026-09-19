import {
  getDefaultLocalEnvironment,
  type Environment
} from '@ddlqhd/agent-sdk-exec';
import type { ToolExecutionContext } from '../core/types.js';

/**
 * Resolve the execution environment for a builtin tool.
 * Agent injects `context.environment`; direct registry calls fall back to a process-local Environment.
 */
export function resolveToolEnvironment(context?: ToolExecutionContext): Environment {
  return context?.environment ?? getDefaultLocalEnvironment();
}
