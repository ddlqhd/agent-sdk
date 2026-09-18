import type { SubagentProfile } from '../../subagents/types.js';
import { resolveProfileBuiltinFragment } from '../../subagents/tool-description.js';
import { exploreBuiltinProfile } from '../../subagents/builtin/explore.js';

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
