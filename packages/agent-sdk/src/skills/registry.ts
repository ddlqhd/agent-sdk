import { existsSync, promises as fs } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import type { Environment, SkillListItem } from '@ddlqhd/agent-sdk-exec';
import { sdkLog } from '../core/log-context.js';
import type { SkillConfig, SkillDefinition, SDKLogContext } from '../core/types.js';
import { SkillLoader, type SkillLoaderConfig } from './loader.js';
import { parseSkillMd } from './parser.js';

export function skillDirFromPath(skillPath: string): string {
  const base = basename(skillPath);
  if (base.toLowerCase() === 'skill.md') {
    return dirname(skillPath);
  }
  return skillPath;
}

function skillMdPathFromPath(skillPath: string): string {
  const base = basename(skillPath);
  if (base.toLowerCase() === 'skill.md') {
    return skillPath;
  }
  return join(skillPath, 'SKILL.md');
}

/**
 * Skill 注册中心
 * Skill 只是一个指导书，不提供工具
 */
export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private loader: SkillLoader;
  private workspaceRoot: string;
  private userBasePath: string;
  private skillConfig?: SkillConfig;
  private readonly sdkLog?: SDKLogContext;
  private environment?: Environment;

  constructor(config?: SkillLoaderConfig & { userBasePath?: string }) {
    this.loader = new SkillLoader(config);
    this.sdkLog = config?.sdkLog;
    this.workspaceRoot = config?.cwd || process.cwd();
    this.userBasePath = config?.userBasePath || homedir();
  }

  /**
   * 注册 Skill
   */
  register(skill: SkillDefinition): void {
    if (this.skills.has(skill.metadata.name)) {
      throw new Error(`Skill "${skill.metadata.name}" is already registered`);
    }

    this.skills.set(skill.metadata.name, skill);
  }

  /**
   * 加载并注册 Skill
   */
  async load(path: string): Promise<void> {
    const skill = await this.loader.load(path);
    this.register(skill);
  }

  /**
   * 加载目录下的所有 Skills
   */
  async loadAll(dirPath: string): Promise<void> {
    const skills = await this.loader.loadAll(dirPath);
    for (const skill of skills) {
      try {
        this.register(skill);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        sdkLog(this.sdkLog, 'warn', {
          component: 'skill',
          event: 'skill.register.error',
          message: 'Failed to register loaded skill definition',
          operation: 'skill_load',
          cwd: this.workspaceRoot,
          errorName: err.name,
          errorMessage: err.message,
          metadata: {
            skillName: skill.metadata.name,
            ...(skill.path ? { path: skill.path } : {})
          }
        });
      }
    }
  }

  /**
   * 注销 Skill
   */
  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  /**
   * 获取 Skill
   */
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * 获取所有 Skill
   */
  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取 Skill 名称列表
   */
  getNames(): string[] {
    return Array.from(this.skills.keys());
  }

  /**
   * 检查 Skill 是否存在
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * 搜索 Skill
   */
  search(query: string): SkillDefinition[] {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter(skill =>
      skill.metadata.name.toLowerCase().includes(lowerQuery) ||
      skill.metadata.description.toLowerCase().includes(lowerQuery) ||
      skill.metadata.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * 按标签过滤
   */
  filterByTag(tag: string): SkillDefinition[] {
    return this.getAll().filter(skill =>
      skill.metadata.tags?.includes(tag)
    );
  }

  /**
   * 获取 Skill 数量
   */
  get size(): number {
    return this.skills.size;
  }

  /**
   * 清空所有 Skill
   */
  clear(): void {
    this.skills.clear();
  }

  /**
   * 导出 Skill 信息
   */
  export(): Array<{
    name: string;
    description: string;
    version?: string;
    path: string;
  }> {
    return this.getAll().map(skill => ({
      name: skill.metadata.name,
      description: skill.metadata.description,
      version: skill.metadata.version,
      path: skill.path
    }));
  }

  /**
   * 获取所有 Skill 的元数据列表（用于 System Prompt）
   */
  getMetadataList(): Array<{ name: string; description: string; argumentHint?: string }> {
    return this.getAll().map(skill => ({
      name: skill.metadata.name,
      description: skill.metadata.description,
      argumentHint: skill.metadata.argumentHint
    }));
  }

  /**
   * 获取用户可调用的 Skills
   */
  getUserInvocableSkills(): Array<{ name: string; description: string; argumentHint?: string }> {
    return this.getAll()
      .filter(skill => skill.metadata.userInvocable !== false)
      .map(skill => ({
        name: skill.metadata.name,
        description: skill.metadata.description,
        argumentHint: skill.metadata.argumentHint
      }));
  }

  /**
   * 获取模型可自动调用的 Skills（用于注入到 system prompt）
   */
  getModelInvocableSkills(): Array<{ name: string; description: string }> {
    return this.getAll()
      .filter(skill => skill.metadata.disableModelInvocation !== true)
      .map(skill => ({
        name: skill.metadata.name,
        description: skill.metadata.description
      }));
  }

  /**
   * 获取格式化的 Skill 列表文本（用于 System Prompt）
   */
  getFormattedList(): string {
    const userInvocable = this.getUserInvocableSkills();
    const modelInvocable = this.getModelInvocableSkills();

    if (userInvocable.length === 0 && modelInvocable.length === 0) {
      return 'No skills are currently available.';
    }

    const sections: string[] = [];

    // 用户可调用的 skills（显示在 / 菜单中）
    if (userInvocable.length > 0) {
      const userSkillsText = userInvocable
        .map(s => {
          const hint = s.argumentHint ? ` ${s.argumentHint}` : '';
          return `- **/${s.name}**${hint}: ${s.description}`;
        })
        .join('\n');
      sections.push(`**User-invocable Skills** (type /skill-name to invoke):
${userSkillsText}`);
    }

    // 模型可自动调用的 skills
    if (modelInvocable.length > 0) {
      const modelSkillsText = modelInvocable
        .map(s => `- **${s.name}**: ${s.description}`)
        .join('\n');
      sections.push(`**Auto-loadable Skills** (Claude can invoke when relevant):
${modelSkillsText}`);
    }

    return sections.join('\n\n') + `

**Note:** Only activate a skill when you need to perform its specific task. For questions about your capabilities, simply describe the available skills.`;
  }

  /**
   * 根据名称获取 Skill 路径
   */
  getSkillPath(name: string): string | undefined {
    const skill = this.skills.get(name);
    return skill?.path;
  }

  getEnvironment(): Environment | undefined {
    return this.environment;
  }

  /**
   * Resolve the SKILL.md body (no frontmatter). Uses Environment.fs when this
   * registry was initialized from `skills/list`.
   */
  async resolveInstructions(name: string): Promise<string> {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill "${name}" not found`);
    }
    if (skill.instructions) {
      return skill.instructions;
    }
    const mdPath = skillMdPathFromPath(skill.path);
    let content: string;
    if (this.environment) {
      const text = await this.environment.fs.readText(mdPath);
      content = text.text ?? text.lines.join('\n');
    } else {
      content = await fs.readFile(mdPath, 'utf-8');
    }
    const parsed = parseSkillMd(content);
    skill.instructions = parsed.content;
    return skill.instructions;
  }

  /**
   * 加载 Skill 全量内容
   */
  async loadFullContent(name: string): Promise<string> {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill "${name}" not found`);
    }

    if (skill.path) {
      try {
        const mdPath = skillMdPathFromPath(skill.path);
        if (this.environment) {
          const text = await this.environment.fs.readText(mdPath);
          return text.text ?? text.lines.join('\n');
        }
        const pathStat = await fs.stat(skill.path);
        const skillMdPath = pathStat.isDirectory() ? join(skill.path, 'SKILL.md') : skill.path;
        return await fs.readFile(skillMdPath, 'utf-8');
      } catch (error) {
        throw new Error(`Failed to read skill file: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (skill.instructions) {
      return skill.instructions;
    }

    throw new Error(`No content available for skill "${name}"`);
  }

  private registerCatalogItem(item: SkillListItem): void {
    this.register({
      metadata: {
        name: item.name,
        description: item.description,
        ...(item.argumentHint !== undefined ? { argumentHint: item.argumentHint } : {}),
        ...(item.userInvocable !== undefined ? { userInvocable: item.userInvocable } : {}),
        ...(item.disableModelInvocation !== undefined
          ? { disableModelInvocation: item.disableModelInvocation }
          : {})
      },
      path: item.path,
      instructions: ''
    });
  }

  private async loadFromEnvironmentCatalog(environment: Environment): Promise<void> {
    const listed = await environment.listSkills({
      workspaceSkillsPath: this.skillConfig?.workspacePath
    });
    for (const item of listed) {
      try {
        this.registerCatalogItem(item);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        sdkLog(this.sdkLog, 'warn', {
          component: 'skill',
          event: 'skill.register.error',
          message: 'Failed to register exec skill catalog entry',
          operation: 'skill_load',
          cwd: this.workspaceRoot,
          errorName: err.name,
          errorMessage: err.message,
          metadata: { skillName: item.name, path: item.path }
        });
      }
    }
  }

  private async loadFromEnvironmentPath(environment: Environment, skillPath: string): Promise<void> {
    const mdPath = skillMdPathFromPath(skillPath);
    const text = await environment.fs.readText(mdPath);
    const parsed = parseSkillMd(text.text ?? text.lines.join('\n'));
    const name =
      parsed.metadata.name && parsed.metadata.name !== 'unknown'
        ? parsed.metadata.name
        : basename(skillDirFromPath(skillPath));
    this.register({
      metadata: { ...parsed.metadata, name },
      path: mdPath,
      instructions: ''
    });
  }

  /**
   * 获取默认 skill 路径
   */
  private getDefaultPaths(): string[] {
    const paths: string[] = [];

    // 用户主目录: {userBasePath}/.claude/skills/
    const userPath = join(this.userBasePath, '.claude', 'skills');
    if (existsSync(userPath)) {
      paths.push(userPath);
    }

    // 工作空间目录: ./.claude/skills/
    const workspacePath = this.skillConfig?.workspacePath
      || join(this.workspaceRoot, '.claude', 'skills');
    if (existsSync(workspacePath)) {
      paths.push(workspacePath);
    }

    return paths;
  }

  /**
   * 初始化加载所有 Skills
   * @param config Skill 配置
   * @param additionalPaths 额外的 skill 路径（来自 AgentConfig.skills）
   */
  async initialize(
    config?: SkillConfig,
    additionalPaths?: string[],
    environment?: Environment
  ): Promise<void> {
    this.skillConfig = config;
    this.environment = environment;

    // 1. 加载默认路径
    if (config?.autoLoad !== false) {
      if (environment) {
        await this.loadFromEnvironmentCatalog(environment);
      }
      const defaultPaths = environment ? [] : this.getDefaultPaths();
      for (const dirPath of defaultPaths) {
        try {
          const beforeCount = this.skills.size;
          await this.loadAll(dirPath);
          const loaded = this.skills.size - beforeCount;
          if (loaded > 0) {
            sdkLog(this.sdkLog, 'info', {
              component: 'skill',
              event: 'skill.load.directory.done',
              message: 'Loaded skill entries from scan directory',
              operation: 'skill_load',
              cwd: this.workspaceRoot,
              metadata: { dirPath, loadedCount: loaded }
            });
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          sdkLog(this.sdkLog, 'warn', {
            component: 'skill',
            event: 'skill.load.directory.error',
            message: 'Failed to load skills directory',
            operation: 'skill_load',
            cwd: this.workspaceRoot,
            errorName: error.name,
            errorMessage: error.message,
            metadata: { dirPath }
          });
        }
      }
    }

    // 2. 加载额外路径
    const allPaths = [...(config?.additionalPaths || []), ...(additionalPaths || [])];
    for (const path of allPaths) {
      try {
        if (environment) {
          await this.loadFromEnvironmentPath(environment, path);
        } else {
          await this.load(path);
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        sdkLog(this.sdkLog, 'warn', {
          component: 'skill',
          event: 'skill.load.path.error',
          message: 'Failed to load configured skill path',
          operation: 'skill_load',
          cwd: this.workspaceRoot,
          errorName: error.name,
          errorMessage: error.message,
          metadata: { path }
        });
      }
    }

    // 3. 输出汇总
    if (this.skills.size > 0) {
      sdkLog(this.sdkLog, 'info', {
        component: 'skill',
        event: 'skill.initialized.summary',
        message: 'Skills registry initialized',
        operation: 'skill_load',
        cwd: this.workspaceRoot,
        metadata: { names: this.getNames() }
      });
    }
  }
}

/**
 * 创建 Skill 注册中心
 */
export function createSkillRegistry(config?: SkillLoaderConfig): SkillRegistry {
  return new SkillRegistry(config);
}
