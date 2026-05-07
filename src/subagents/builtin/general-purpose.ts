import type { SubagentProfile } from '../types.js';

export const generalPurposeBuiltinProfile: SubagentProfile = {
  name: 'general-purpose',
  description:
    'General-purpose subagent for multi-step tasks. Uses safe parent tools by default (non-dangerous).',
  source: 'builtin'
};
