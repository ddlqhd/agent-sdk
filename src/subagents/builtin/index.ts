import type { SubagentProfile } from '../types.js';
import { exploreBuiltinProfile } from './explore.js';
import { generalPurposeBuiltinProfile } from './general-purpose.js';

/** Built-in profile names (for docs and compatibility). */
export const BUILTIN_SUBAGENT_NAMES = [
  generalPurposeBuiltinProfile.name,
  exploreBuiltinProfile.name
] as const;

export type BuiltinSubagentName = (typeof BUILTIN_SUBAGENT_NAMES)[number];

export { exploreBuiltinProfile, EXPLORE_SYSTEM_FRAGMENT, SUBAGENT_EXPLORE_DEFAULT_TOOL_NAMES } from './explore.js';
export { subagentExploreDefaultsUnavailableMessage } from './explore.js';
export { generalPurposeBuiltinProfile } from './general-purpose.js';

export function getBuiltinSubagentProfiles(): SubagentProfile[] {
  return [generalPurposeBuiltinProfile, exploreBuiltinProfile];
}
