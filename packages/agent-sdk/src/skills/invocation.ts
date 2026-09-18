import type { SkillRegistry } from './registry.js';
import { createSkillTemplateProcessor } from './template.js';

/**
 * Runtime values for template expansion (session id, working directory) when
 * building skill invocation payloads.
 */
export interface SkillInvocationRuntime {
  sessionId?: string;
  cwd?: string;
}

/**
 * Build the skill payload from **body** instructions only: SKILL.md YAML frontmatter is
 * not included. Runs template/shell processing and applies the ARGUMENTS fallback on the body.
 * The result starts with a `Base Path:` line, then a `{name} skill loaded successfully.`
 * line, then the processed body. Does not enforce {@link SkillMetadata.userInvocable} or
 * {@link SkillMetadata.disableModelInvocation}.
 */
export async function buildSkillInvocationPayload(
  skillRegistry: SkillRegistry,
  name: string,
  args: string = '',
  runtime: SkillInvocationRuntime = {}
): Promise<string> {
  const skill = skillRegistry.get(name);
  if (!skill) {
    throw new Error(`Skill "${name}" not found`);
  }

  const rawBody = skill.instructions;
  const processor = createSkillTemplateProcessor({
    skillDir: skill.path || '',
    sessionId: runtime.sessionId,
    cwd: runtime.cwd ?? process.cwd()
  });
  let processedContent = await processor.process(rawBody, args);

  if (args && !rawBody.includes('$ARGUMENTS') && !rawBody.includes('$0')) {
    processedContent += `\n\nARGUMENTS: ${args}`;
  }

  const basePathLine =
    skill.path && skill.path.length > 0
      ? `Base Path: ${skill.path}`
      : 'Base Path: (unknown)';

  const successLine = `${skill.metadata.name} skill loaded successfully.`;

  return `${basePathLine}\n\n${successLine}\n\n${processedContent}`;
}
