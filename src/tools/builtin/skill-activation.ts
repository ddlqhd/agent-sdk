import { z } from 'zod';
import { createTool } from '../registry.js';
import type { SkillRegistry } from '../../skills/registry.js';

/**
 * 创建 Skill 工具
 */
export function createSkillTool(skillRegistry: SkillRegistry) {
  return createTool({
    name: 'Skill',
    category: 'skills',
    description: `Execute a skill within the main conversation.

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

How to invoke:
- Use this tool with the skill name and optional arguments
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, invoke the relevant Skill tool BEFORE generating any other response about the task
- Do not invoke a skill that is already running`,
    parameters: z.object({
      skill: z.string().describe('The skill name. E.g., "commit", "review-pr", or "pdf"'),
      args: z.string().optional().describe('Optional arguments for the skill')
    }),
    handler: async ({ skill: skillName }) => {
      try {
        if (!skillRegistry.has(skillName)) {
          const available = skillRegistry.getMetadataList();
          const availableList = available.length > 0
            ? available.map(s => `- ${s.name}: ${s.description}`).join('\n')
            : 'No skills available.';

          return {
            content: `Skill "${skillName}" not found.\n\nAvailable skills:\n${availableList}`,
            isError: true
          };
        }

        const fullContent = await skillRegistry.loadFullContent(skillName);
        const skill = skillRegistry.get(skillName);

        const sections: string[] = [];
        sections.push(`# Skill: ${skill?.metadata.name || skillName}`);
        sections.push(`Description: ${skill?.metadata.description || ''}`);
        sections.push(`Base Path: ${skill?.path || ''}`);
        sections.push('');
        sections.push('---');
        sections.push('');
        sections.push(fullContent);

        return {
          content: sections.join('\n')
        };
      } catch (error) {
        return {
          content: `Error activating skill "${skillName}": ${error instanceof Error ? error.message : String(error)}`,
          isError: true
        };
      }
    }
  });
}

/**
 * 获取 Skill 相关工具
 */
export function getSkillTools(skillRegistry: SkillRegistry) {
  return [createSkillTool(skillRegistry)];
}
