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
import { getSkillTools, type CreateSkillToolOptions } from './skill-activation.js';
import { getSubagentTools } from './subagent.js';

/**
 * 内置工具组合选项：交互解析与 Skill 模板运行时。
 */
export type GetAllBuiltinToolsOptions = CreateAskUserQuestionToolOptions & CreateSkillToolOptions;

/**
 * 获取所有内置工具
 * @param skillRegistry - Skill注册中心，用于激活skill工具
 * @param options - 可选：AskUserQuestion 的 resolve，以及 {@link CreateSkillToolOptions.skillInvocationRuntime}
 */
export function getAllBuiltinTools(
  skillRegistry: SkillRegistry,
  options?: GetAllBuiltinToolsOptions
): ToolDefinition[] {
  return [
    ...getFileSystemTools(),
    ...getShellTools(),
    ...getGrepTools(),
    ...getWebTools(),
    ...getPlanningTools(),
    ...getInteractionTools(options),
    ...getSubagentTools(),
    ...getSkillTools(skillRegistry, options)
  ];
}

/**
 * 获取安全的内置工具 (不含危险操作)
 * @param skillRegistry - Skill注册中心，用于激活skill工具
 * @param options - 同 {@link getAllBuiltinTools}
 */
export function getSafeBuiltinTools(
  skillRegistry: SkillRegistry,
  options?: GetAllBuiltinToolsOptions
): ToolDefinition[] {
  return getAllBuiltinTools(skillRegistry, options).filter((tool) => !tool.isDangerous);
}
