import { describe, it, expect } from 'vitest';
import { parseSubagentMd, metadataToSubagentProfile } from '../../src/subagents/parser.js';

describe('subagent markdown parser', () => {
  it('parses tools as comma-separated string', () => {
    const raw = `---
name: reviewer
description: Reviews code
tools: Read, Glob, Grep
---

You are a reviewer.`;
    const { metadata, content } = parseSubagentMd(raw);
    const profile = metadataToSubagentProfile(metadata, content, '/tmp/reviewer.md');
    expect(profile.tools).toEqual(['Read', 'Glob', 'Grep']);
    expect(profile.promptBody).toContain('You are a reviewer');
  });

  it('parses disallowedTools; promptBody is markdown body only (ignores legacy prompt key in YAML)', () => {
    const raw = `---
name: x
description: Test
disallowedTools: Write, Bash
prompt: Ignored frontmatter prompt line.
---

First line from body.

Body line.`;
    const { metadata, content } = parseSubagentMd(raw);
    const profile = metadataToSubagentProfile(metadata, content, '/tmp/x.md');
    expect(profile.disallowedTools).toEqual(['Write', 'Bash']);
    expect(profile.promptBody).toContain('First line from body');
    expect(profile.promptBody).toContain('Body line');
    expect(profile.promptBody).not.toContain('Ignored frontmatter prompt line');
  });

  it('only parses frontmatter at file start', () => {
    const raw = `# Title

---
name: should-not-parse
description: no
---

Body line.`;
    const { metadata, content } = parseSubagentMd(raw);
    expect(metadata).toEqual({});
    expect(content).toContain('name: should-not-parse');
  });

  it('uses multi-line markdown body as promptBody', () => {
    const raw = `---
name: blocky
description: Test
---

First line.
Second line.

Body line.`;
    const { metadata, content } = parseSubagentMd(raw);
    const profile = metadataToSubagentProfile(metadata, content, '/tmp/blocky.md');
    expect(profile.promptBody).toContain('First line.');
    expect(profile.promptBody).toContain('Second line.');
    expect(profile.promptBody).toContain('Body line.');
  });
});
