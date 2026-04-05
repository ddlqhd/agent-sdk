import type { SkillConfig } from '../../src/core/types.js';

/**
 * Pass as {@link AgentConfig.skillConfig} in unit tests so skills are not auto-loaded from
 * the developer's ~/.claude/skills or ./.claude/skills (deterministic CI and local runs).
 */
export const SKILL_CONFIG_NO_AUTOLOAD = {
  autoLoad: false
} as const satisfies SkillConfig;
