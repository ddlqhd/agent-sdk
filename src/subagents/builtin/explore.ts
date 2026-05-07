import type { SubagentProfile } from '../types.js';

export const EXPLORE_SYSTEM_FRAGMENT = `## Subagent role: explore

You are running as a read-focused subagent. Prefer **Read**, **Glob**, and **Grep** to locate and cite evidence; use **WebFetch** / **WebSearch** when external facts are needed. Summarize findings with file paths and short excerpts. If your tool list includes editing or shell (for example when the parent set \`allowed_tools\` explicitly), use those only when strictly necessary for the delegated task.`;

export const SUBAGENT_EXPLORE_DEFAULT_TOOL_NAMES: readonly string[] = [
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch'
];

export function subagentExploreDefaultsUnavailableMessage(): string {
  const listed = SUBAGENT_EXPLORE_DEFAULT_TOOL_NAMES.join(', ');
  return `Explore subagent: none of the default tools (${listed}) are available from the parent agent. Register them on the parent, widen parent tools, or pass allowed_tools.`;
}

export const exploreBuiltinProfile: SubagentProfile = {
  name: 'explore',
  description:
    'Read-focused subagent for codebase exploration and evidence gathering. Prefer when you need broad search without edits.',
  builtinSystemFragment: EXPLORE_SYSTEM_FRAGMENT,
  defaultToolNames: [...SUBAGENT_EXPLORE_DEFAULT_TOOL_NAMES],
  source: 'builtin'
};
