import { describe, it, expect } from 'vitest';
import { buildDefaultSystemPromptShell, DEFAULT_SYSTEM_PROMPT } from '../../src/core/prompts.js';

describe('buildDefaultSystemPromptShell', () => {
  it('with skills: includes Skills section, SKILL_LIST placeholder, and legacy Custom Tools phrasing', () => {
    const shell = buildDefaultSystemPromptShell(true);

    expect(shell).toContain('{{SKILL_LIST}}');
    expect(shell).toContain('### Skills');
    expect(shell).toContain('- **Custom Tools**: additional tools registered by the user or skills');
    expect(shell).toContain('### Sessions');
    expect(shell).not.toContain('{{CUSTOM_TOOLS_PHRASE}}');
    expect(shell).not.toContain('{{SKILLS_SECTION}}');
  });

  it('without skills: omits Skills block and placeholder, uses host phrasing for Custom Tools', () => {
    const shell = buildDefaultSystemPromptShell(false);

    expect(shell).not.toContain('{{SKILL_LIST}}');
    expect(shell).not.toContain('### Skills');
    expect(shell).toContain('- **Custom Tools**: additional tools registered by the user or host');
    expect(shell).toContain('### Sessions');
    expect(shell).not.toContain('{{CUSTOM_TOOLS_PHRASE}}');
    expect(shell).not.toContain('{{SKILLS_SECTION}}');
  });

  it('connects Bash guidance to Sessions when skills are off (no stray gap)', () => {
    const shell = buildDefaultSystemPromptShell(false);
    const idxBash = shell.indexOf('not covered above.');
    const idxSessions = shell.indexOf('### Sessions');
    expect(idxBash).toBeGreaterThan(-1);
    expect(idxSessions).toBeGreaterThan(idxBash);
    expect(shell.slice(idxBash, idxSessions)).not.toContain('### Skills');
  });

  it('DEFAULT_SYSTEM_PROMPT matches loadSkills true shell', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toBe(buildDefaultSystemPromptShell(true));
  });

  it('with and without skills both retain shared framework sections', () => {
    const withSkills = buildDefaultSystemPromptShell(true);
    const without = buildDefaultSystemPromptShell(false);
    for (const shell of [withSkills, without]) {
      expect(shell).toContain('## Task Execution Principles');
      expect(shell).toContain('## Tool hooks');
      expect(shell).toContain('## Interaction Style');
    }
  });
});
