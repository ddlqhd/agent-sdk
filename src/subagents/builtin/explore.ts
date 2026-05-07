import type { SubagentProfile } from '../types.js';

export const EXPLORE_SYSTEM_FRAGMENT = `## Subagent role: explore

You are running as a read-focused subagent. Prefer **Read**, **Glob**, and **Grep** to locate and cite evidence; use **WebFetch** / **WebSearch** when external facts are needed. Summarize findings with file paths and short excerpts. Your tool set is the parent agent's tools minus **Write**, **Edit**, and **Agent** (read-only mutation rule); use non-file tools from that set only when they serve the delegated task.`;

export const exploreBuiltinProfile: SubagentProfile = {
  name: 'explore',
  description:
    'Read-focused subagent for codebase exploration and evidence gathering. Prefer when you need broad search without edits.',
  builtinSystemFragment: EXPLORE_SYSTEM_FRAGMENT,
  disallowedTools: ['Write', 'Edit', 'Agent'],
  source: 'builtin'
};
