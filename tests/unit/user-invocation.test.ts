import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSkillRegistry } from '../../src/skills/registry.js';
import { invokeUserSkill } from '../../src/skills/user-invocation.js';
import { buildSlashMenuItems } from '../../src/cli/tui/slash-menu.js';

describe('user skill slash invocation with YAML metadata', () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = join(
      tmpdir(),
      `user_skill_invocation_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(workDir, { recursive: true });

    const blockedDir = join(workDir, 'blocked-skill');
    await fs.mkdir(blockedDir, { recursive: true });
    await fs.writeFile(
      join(blockedDir, 'SKILL.md'),
      `---
name: blocked-skill
description: Not user invocable
userInvocable: false
---

Blocked body.
`,
      'utf-8'
    );

    const hintedDir = join(workDir, 'hinted-skill');
    await fs.mkdir(hintedDir, { recursive: true });
    await fs.writeFile(
      join(hintedDir, 'SKILL.md'),
      `---
name: hinted-skill
description: Skill with hint
argumentHint: "[file]"
---

Hinted body.
`,
      'utf-8'
    );
  });

  afterAll(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('rejects user invocation when userInvocable is false', async () => {
    const reg = createSkillRegistry({ cwd: workDir });
    await reg.load(join(workDir, 'blocked-skill'));

    await expect(invokeUserSkill(reg, 'blocked-skill')).rejects.toThrow(
      'Skill "blocked-skill" is not user-invocable'
    );
  });

  it('exposes argumentHint in slash menu metadata', async () => {
    const reg = createSkillRegistry({ cwd: workDir });
    await reg.load(join(workDir, 'hinted-skill'));

    const skill = reg.get('hinted-skill');
    expect(skill?.metadata.argumentHint).toBe('[file]');

    const items = buildSlashMenuItems(reg.getUserInvocableSkills());
    const hinted = items.find(item => item.key === 'skill:hinted-skill');
    expect(hinted?.description).toBe('Skill with hint ([file])');
  });
});
