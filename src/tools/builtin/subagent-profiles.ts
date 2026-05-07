/**
 * Back-compat re-exports for built-in subagent fragments and explore defaults.
 * Prefer importing from `@ddlqhd/agent-sdk` / `../subagents/index.js`.
 */

import type { SubagentProfile } from '../../subagents/types.js';
import { resolveProfileBuiltinFragment } from '../../subagents/tool-description.js';
import {
  exploreBuiltinProfile,
  SUBAGENT_EXPLORE_DEFAULT_TOOL_NAMES,
  subagentExploreDefaultsUnavailableMessage
} from '../../subagents/builtin/explore.js';

export { SUBAGENT_EXPLORE_DEFAULT_TOOL_NAMES, subagentExploreDefaultsUnavailableMessage };

export type SubagentType = string;

export function resolveSubagentTypeAppend(
  type: string,
  subagent?: { subagentTypePrompts?: Partial<Record<string, string>> }
): string | undefined {
  const profile: SubagentProfile =
    type === exploreBuiltinProfile.name
      ? exploreBuiltinProfile
      : { name: type, description: '' };
  return resolveProfileBuiltinFragment(profile, subagent);
}
