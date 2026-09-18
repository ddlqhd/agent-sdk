import type { SkillRegistry } from './registry.js';
import { buildSkillInvocationPayload, type SkillInvocationRuntime } from './invocation.js';

/**
 * 解析用户输入中的 `/skill-name [args]` 形式（仅当 registry 中存在该 skill 时视为命中）。
 */
export function parseUserSkillSlashCommand(
  input: string,
  registry: SkillRegistry
): { name: string; args: string } | null {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return null;
  }

  const match = trimmed.match(/^\/([^\s\/]+)(?:\s+(.*))?$/);

  if (!match) {
    return null;
  }

  const name = match[1];
  const args = match[2] || '';

  if (!registry.has(name)) {
    return null;
  }

  return { name, args };
}

/**
 * 按名称加载 skill 并做模板处理；校验存在性与 {@link SkillMetadata.userInvocable}。
 */
export async function invokeUserSkill(
  registry: SkillRegistry,
  name: string,
  args: string = '',
  runtime: SkillInvocationRuntime = {}
): Promise<string> {
  const skill = registry.get(name);

  if (!skill) {
    const available = registry.getNames();
    throw new Error(
      `Skill "${name}" not found. Available skills: ${available.join(', ') || 'none'}`
    );
  }

  if (skill.metadata.userInvocable === false) {
    throw new Error(`Skill "${name}" is not user-invocable`);
  }

  return await buildSkillInvocationPayload(registry, name, args, runtime);
}

export interface ProcessUserInputForSkillsResult {
  invoked: boolean;
  skillName?: string;
  prompt: string;
}

/**
 * 检测并处理用户发起的 skill 调用；失败时回退为带错误说明的 prompt（与 Agent.processInput 行为一致）。
 */
export async function processUserInputForSkills(
  registry: SkillRegistry,
  input: string,
  runtime: SkillInvocationRuntime
): Promise<ProcessUserInputForSkillsResult> {
  const invocation = parseUserSkillSlashCommand(input, registry);

  if (!invocation) {
    return { invoked: false, prompt: input };
  }

  const { name, args } = invocation;

  try {
    const prompt = await invokeUserSkill(registry, name, args, runtime);
    return { invoked: true, skillName: name, prompt };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      invoked: false,
      prompt: `Error invoking skill "${name}": ${errorMsg}\n\nOriginal input: ${input}`
    };
  }
}
