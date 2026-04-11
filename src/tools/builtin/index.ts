// Built-in tools
export * from './filesystem.js';
export * from './shell.js';
export * from './grep.js';
export * from './web.js';
export * from './planning.js';
export * from './interaction.js';
export * from './skill-activation.js';
export * from './subagent.js';

import type { ToolDefinition } from '../../core/types.js';
import type { SkillRegistry } from '../../skills/registry.js';
import { getFileSystemTools } from './filesystem.js';
import { getShellTools } from './shell.js';
import { getGrepTools } from './grep.js';
import { getWebTools } from './web.js';
import { getPlanningTools } from './planning.js';
import { getInteractionTools, type CreateAskUserQuestionToolOptions } from './interaction.js';
import { getSkillTools } from './skill-activation.js';
import { getSubagentTools } from './subagent.js';

/**
 * 获取所有内置工具
 * @param skillRegistry - Skill注册中心，用于激活skill工具
 * @param interactionOptions - 可选：AskUserQuestion 的 {@link CreateAskUserQuestionToolOptions}
 */
export function getAllBuiltinTools(
  skillRegistry: SkillRegistry,
  interactionOptions?: CreateAskUserQuestionToolOptions
): ToolDefinition[] {
  return [
    ...getFileSystemTools(),
    ...getShellTools(),
    ...getGrepTools(),
    ...getWebTools(),
    ...getPlanningTools(),
    ...getInteractionTools(interactionOptions),
    ...getSubagentTools(),
    ...getSkillTools(skillRegistry)
  ];
}

/**
 * 获取安全的内置工具 (不含危险操作)
 * @param skillRegistry - Skill注册中心，用于激活skill工具
 * @param interactionOptions - 可选：AskUserQuestion 的 {@link CreateAskUserQuestionToolOptions}
 */
export function getSafeBuiltinTools(
  skillRegistry: SkillRegistry,
  interactionOptions?: CreateAskUserQuestionToolOptions
): ToolDefinition[] {
  return getAllBuiltinTools(skillRegistry, interactionOptions).filter((tool) => !tool.isDangerous);
}
