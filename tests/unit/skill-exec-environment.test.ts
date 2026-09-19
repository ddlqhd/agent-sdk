import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLocalEnvironment } from '@ddlqhd/agent-sdk-exec';
import { buildSkillInvocationPayload } from '../../packages/agent-sdk/src/skills/invocation.js';
import { createSkillRegistry } from '../../packages/agent-sdk/src/skills/registry.js';

function writeSkill(dir: string, name: string, description: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
  );
}

describe('SkillRegistry via Environment catalog', () => {
  it('injects name/description from skills/list and reads the body on invoke', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'skill-reg-ws-'));
    const userHome = mkdtempSync(join(tmpdir(), 'skill-reg-home-'));
    writeSkill(
      join(userHome, '.claude', 'skills', 'home-demo'),
      'home-demo',
      'Home skill',
      'Run from ${CLAUDE_SKILL_DIR}.\n!`printf template-ok`'
    );
    writeSkill(
      join(workspace, '.claude', 'skills', 'ws-demo'),
      'ws-demo',
      'Workspace skill',
      'Workspace body'
    );

    const env = createLocalEnvironment({ workspaceRoot: workspace, userHome });
    const registry = createSkillRegistry({ cwd: workspace, userBasePath: '/tmp/control-plane-home-should-not-scan' });
    await registry.initialize(undefined, undefined, env);

    const listed = registry.getFormattedList();
    expect(listed).toContain('home-demo');
    expect(listed).toContain('Home skill');
    expect(listed).toContain('ws-demo');
    expect(listed).not.toContain('Workspace body');
    expect(registry.get('home-demo')?.instructions).toBe('');

    const payload = await buildSkillInvocationPayload(registry, 'home-demo', '', {
      environment: env,
      cwd: workspace
    });
    expect(payload).toContain('home-demo skill loaded successfully.');
    expect(payload).toContain(`Base Path: ${join(userHome, '.claude', 'skills', 'home-demo')}`);
    expect(payload).toContain('template-ok');
    expect(existsSync(join(workspace, '.agent-sdk'))).toBe(false);
  });

  it('honors skillConfig.workspacePath on the execution plane', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'skill-reg-custom-'));
    const userHome = mkdtempSync(join(tmpdir(), 'skill-reg-custom-home-'));
    const customDir = join(workspace, 'extra-skills', 'custom-demo');
    writeSkill(customDir, 'custom-demo', 'Custom catalog', 'Custom body');

    const env = createLocalEnvironment({ workspaceRoot: workspace, userHome });
    const registry = createSkillRegistry({ cwd: workspace, userBasePath: userHome });
    await registry.initialize({ workspacePath: join(workspace, 'extra-skills') }, undefined, env);

    expect(registry.get('custom-demo')?.metadata.description).toBe('Custom catalog');
    expect(registry.getFormattedList()).not.toContain('Custom body');
  });
});
