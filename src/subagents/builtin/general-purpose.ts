import type { SubagentProfile } from '../types.js';

export const generalPurposeBuiltinProfile: SubagentProfile = {
  name: 'general-purpose',
  description:
    'General-purpose subagent for multi-step tasks. Inherits parent tools except the Agent tool (and AskUserQuestion, which subagents cannot use).',
  source: 'builtin'
};
