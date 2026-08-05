import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentConfig, SkillConfig } from '../../src/core/types.js';

const VITEST_TMP_ROOT = join(process.cwd(), '.vitest-tmp');

/**
 * Pass as {@link AgentConfig.skillConfig} in unit tests so skills are not auto-loaded from
 * the developer's ~/.claude/skills or ./.claude/skills (deterministic CI and local runs).
 */
export const SKILL_CONFIG_NO_AUTOLOAD = {
  autoLoad: false
} as const satisfies SkillConfig;

const isolatedUserBasePaths = new Set<string>();

/**
 * Create a temp directory for {@link AgentConfig.userBasePath} (session/hook/skill user paths).
 * Prefer {@link agentTestDefaults} so Agent tests never touch the real home directory.
 */
export function createIsolatedUserBasePath(prefix = 'agent-sdk-agent-test-'): string {
  mkdirSync(VITEST_TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(VITEST_TMP_ROOT, prefix));
  isolatedUserBasePaths.add(dir);
  return dir;
}

/** Remove dirs created by {@link createIsolatedUserBasePath} in a suite teardown. */
export function cleanupIsolatedUserBasePaths(): void {
  for (const dir of isolatedUserBasePaths) {
    rmSync(dir, { recursive: true, force: true });
  }
  isolatedUserBasePaths.clear();
}

/**
 * Common Agent unit-test defaults: no memory/skills autoload and isolated JSONL session storage.
 */
export function agentTestDefaults(overrides: AgentConfig): AgentConfig {
  return {
    memory: false,
    skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
    storage: { type: 'jsonl' },
    userBasePath: createIsolatedUserBasePath(),
    ...overrides
  };
}
