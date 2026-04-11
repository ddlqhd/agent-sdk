/**
 * Built-in subagent type profiles: system prompt fragments and explore default tools.
 */

/** Values must stay in sync with `subagentRequestSchema.subagent_type` in subagent.ts. */
export const SUBAGENT_TYPES = ['general-purpose', 'explore'] as const;
export type SubagentType = (typeof SUBAGENT_TYPES)[number];

const EXPLORE_SYSTEM_APPEND = `## Subagent role: explore

You are running as a read-focused subagent. Prefer **Read**, **Glob**, and **Grep** to locate and cite evidence; use **WebFetch** / **WebSearch** when external facts are needed. Summarize findings with file paths and short excerpts. If your tool list includes editing or shell (for example when the parent set \`allowed_tools\` explicitly), use those only when strictly necessary for the delegated task.`;

/**
 * Default tool names for `explore` when the caller did not set `allowed_tools` or `subagent.defaultAllowedTools`.
 * Matched against the parent registry (unknown names are ignored).
 */
export const SUBAGENT_EXPLORE_DEFAULT_TOOL_NAMES: readonly string[] = [
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch'
];

/**
 * Error text when `explore` used the default name list but none matched the parent registry (single source of truth with {@link SUBAGENT_EXPLORE_DEFAULT_TOOL_NAMES}).
 */
export function subagentExploreDefaultsUnavailableMessage(): string {
  const listed = SUBAGENT_EXPLORE_DEFAULT_TOOL_NAMES.join(', ');
  return `Explore subagent: none of the default tools (${listed}) are available from the parent agent. Register them on the parent, widen parent tools, or pass allowed_tools.`;
}

/**
 * Resolves the system prompt fragment appended for a subagent run (before `request.system_prompt`).
 * `subagent.subagentTypePrompts[type]` replaces the built-in fragment for that type when provided.
 */
export function resolveSubagentTypeAppend(
  type: SubagentType,
  subagent?: {
    subagentTypePrompts?: Partial<Record<SubagentType, string>>;
  }
): string | undefined {
  const custom = subagent?.subagentTypePrompts?.[type];
  if (custom !== undefined) {
    const trimmed = custom.trim();
    return trimmed === '' ? undefined : custom;
  }
  return type === 'explore' ? EXPLORE_SYSTEM_APPEND : undefined;
}
