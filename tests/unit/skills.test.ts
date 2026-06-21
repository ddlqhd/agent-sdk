import { describe, it, expect } from 'vitest';
import { parseSkillMd } from '../../src/skills/parser.js';

describe('Skill Parser', () => {
  it('should parse SKILL.md with frontmatter', () => {
    const content = `---
name: test-skill
description: "A test skill"
version: "1.0.0"
tags:
  - test
  - example
---

# Test Skill

This is a test skill.

## Instructions

Do something useful.`;

    const result = parseSkillMd(content);

    expect(result.metadata.name).toBe('test-skill');
    expect(result.metadata.description).toBe('A test skill');
    expect(result.metadata.version).toBe('1.0.0');
    expect(result.metadata.tags).toEqual(['test', 'example']);
    expect(result.content).toContain('# Test Skill');
    expect(result.content).toContain('Do something useful');
  });

  it('should parse SKILL.md without frontmatter', () => {
    const content = `# My Skill

This is a skill without frontmatter.

The name should be inferred from the title.`;

    const result = parseSkillMd(content);

    expect(result.metadata.name).toBe('my-skill');
    expect(result.content).toContain('# My Skill');
  });

  it('should handle empty frontmatter', () => {
    const content = `---
---

# Empty Frontmatter`;

    const result = parseSkillMd(content);

    expect(result.metadata.name).toBe('empty-frontmatter');
    expect(result.content).toContain('# Empty Frontmatter');
  });

  it('should parse array values in frontmatter', () => {
    const content = `---
name: array-test
dependencies:
  - dep1
  - dep2
tags:
  - tag1
  - tag2
---

Content here`;

    const result = parseSkillMd(content);

    expect(result.metadata.dependencies).toEqual(['dep1', 'dep2']);
    expect(result.metadata.tags).toEqual(['tag1', 'tag2']);
  });

  it('should handle quoted values', () => {
    const content = `---
name: 'quoted-name'
description: "quoted description"
---

Content`;

    const result = parseSkillMd(content);

    expect(result.metadata.name).toBe('quoted-name');
    expect(result.metadata.description).toBe('quoted description');
  });

  it('should handle comments in frontmatter', () => {
    const content = `---
# This is a comment
name: test
# Another comment
description: Test
---

Content`;

    const result = parseSkillMd(content);

    expect(result.metadata.name).toBe('test');
    expect(result.metadata.description).toBe('Test');
  });

  it('should parse multiline block scalar description', () => {
    const content = `---
name: multiline-skill
description: |
  Line one
  Line two
---

Body`;

    const result = parseSkillMd(content);

    expect(result.metadata.description).toBe('Line one\nLine two');
    expect(result.content).toBe('Body');
  });

  it('should parse folded scalar description', () => {
    const content = `---
name: folded-skill
description: >
  Folded
  content
---

Body`;

    const result = parseSkillMd(content);

    expect(result.metadata.description).toBe('Folded content');
    expect(result.content).toBe('Body');
  });

  it('should parse camelCase metadata fields', () => {
    const content = `---
name: hinted-skill
description: Has hint
argumentHint: "[file]"
userInvocable: false
disableModelInvocation: true
---

Body`;

    const result = parseSkillMd(content);

    expect(result.metadata.argumentHint).toBe('[file]');
    expect(result.metadata.userInvocable).toBe(false);
    expect(result.metadata.disableModelInvocation).toBe(true);
  });

  it('should coerce numeric version to string', () => {
    const content = `---
name: version-skill
description: Version test
version: 1.0
---

Body`;

    const result = parseSkillMd(content);

    expect(result.metadata.version).toBe('1');
  });

  it('should throw on invalid YAML frontmatter', () => {
    const content = `---
name: [unclosed
description: bad
---

Body`;

    expect(() => parseSkillMd(content)).toThrow(/Invalid YAML frontmatter in SKILL\.md/);
  });

  it('should ignore unknown frontmatter fields', () => {
    const content = `---
name: clean-skill
description: Clean metadata
customField: should-not-appear
---

Body`;

    const result = parseSkillMd(content);

    expect(result.metadata.name).toBe('clean-skill');
    expect(result.metadata.description).toBe('Clean metadata');
    expect('customField' in result.metadata).toBe(false);
  });
});
