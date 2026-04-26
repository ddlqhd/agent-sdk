import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSkillRegistry } from '../../src/skills/registry.js';
import { buildSkillInvocationPayload } from '../../src/skills/invocation.js';
import { createSkillTool } from '../../src/tools/builtin/skill-activation.js';
import { ToolRegistry } from '../../src/tools/registry.js';

describe('buildSkillInvocationPayload and Skill tool alignment', () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = join(
      tmpdir(),
      `skill_invocation_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(workDir, { recursive: true });

    const plainDir = join(workDir, 'plain-skill');
    await fs.mkdir(plainDir, { recursive: true });
    await fs.writeFile(
      join(plainDir, 'SKILL.md'),
      `---
name: plain-skill
description: No placeholders
---

Do the thing.
`,
      'utf-8'
    );

    const argsDir = join(workDir, 'args-skill');
    await fs.mkdir(argsDir, { recursive: true });
    await fs.writeFile(
      join(argsDir, 'SKILL.md'),
      `---
name: args-skill
description: Has ARGUMENTS
---

Say: $ARGUMENTS
`,
      'utf-8'
    );

    const noModelDir = join(workDir, 'no-model-skill');
    await fs.mkdir(noModelDir, { recursive: true });
    await fs.writeFile(
      join(noModelDir, 'SKILL.md'),
      `---
name: no-model-skill
description: Model cannot invoke
disableModelInvocation: true
---

Text
`,
      'utf-8'
    );
  });

  afterAll(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('omits frontmatter, adds Base Path and success line, and appends ARGUMENTS when needed', async () => {
    const reg = createSkillRegistry({ cwd: workDir });
    const plainPath = join(workDir, 'plain-skill');
    await reg.load(plainPath);
    const out = await buildSkillInvocationPayload(reg, 'plain-skill', 'x y', { cwd: workDir });
    expect(out).toMatch(/^Base Path: /);
    expect(out).toContain(`Base Path: ${plainPath}`);
    expect(out).toContain('plain-skill skill loaded successfully.');
    expect(out).not.toMatch(/---\s*\nname:\s*plain-skill/);
    expect(out).not.toContain('description: No placeholders');
    expect(out).toContain('ARGUMENTS: x y');
  });

  it('Skill tool output matches buildSkillInvocationPayload for same name and args', async () => {
    const reg = createSkillRegistry({ cwd: workDir });
    await reg.load(join(workDir, 'args-skill'));

    const expected = await buildSkillInvocationPayload(reg, 'args-skill', 'hello', { cwd: workDir });
    const tool = createSkillTool(reg, {
      skillInvocationRuntime: () => ({ cwd: workDir })
    });
    const tr = new ToolRegistry();
    tr.register(tool);
    const result = await tr.execute('Skill', { skill: 'args-skill', args: 'hello' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe(expected);
  });

  it('Skill tool passes args the same as buildSkillInvocationPayload (plain + args)', async () => {
    const reg = createSkillRegistry({ cwd: workDir });
    await reg.load(join(workDir, 'plain-skill'));

    const expected = await buildSkillInvocationPayload(reg, 'plain-skill', 'only-arg', { cwd: workDir });
    const tool = createSkillTool(reg, {
      skillInvocationRuntime: () => ({ cwd: workDir, sessionId: 'sess-1' })
    });
    const tr = new ToolRegistry();
    tr.register(tool);
    const result = await tr.execute('Skill', { skill: 'plain-skill', args: 'only-arg' });
    expect(result.content).toBe(expected);
  });

  it('returns isError when disableModelInvocation is true', async () => {
    const reg = createSkillRegistry({ cwd: workDir });
    await reg.load(join(workDir, 'no-model-skill'));
    const tool = createSkillTool(reg);
    const tr = new ToolRegistry();
    tr.register(tool);
    const result = await tr.execute('Skill', { skill: 'no-model-skill' });
    expect(result.isError).toBe(true);
    expect(String(result.content)).toContain('not available for automatic invocation');
  });
});
