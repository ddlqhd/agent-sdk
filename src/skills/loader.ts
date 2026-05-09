import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import type { SDKLogSink, SkillDefinition } from '../core/types.js';
import { emitSDKLog } from '../core/logger.js';
import { parseSkillMd, inferMetadataFromPath } from './parser.js';

/**
 * Skill 加载器配置
 */
export interface SkillLoaderConfig {
  /** 工作目录 */
  cwd?: string;
  /** 用户级基础路径 */
  userBasePath?: string;
  /** 文件过滤 */
  filter?: (path: string) => boolean;
  /** 结构化加载失败日志（宿主 logger） */
  sdkLog?: SDKLogSink;
}

/**
 * Skill 加载器
 * Skill 只是一个指导书，不加载工具脚本
 */
export class SkillLoader {
  private config: SkillLoaderConfig;

  constructor(config: SkillLoaderConfig = {}) {
    this.config = {
      cwd: process.cwd(),
      ...config
    };
  }

  /**
   * 加载单个 Skill
   */
  async load(skillPath: string): Promise<SkillDefinition> {
    const resolvedPath = resolve(this.config.cwd!, skillPath);

    // 检查是文件还是目录
    const stat = await this.getPathType(resolvedPath);

    if (stat === 'file') {
      return this.loadFromFile(resolvedPath);
    } else if (stat === 'directory') {
      return this.loadFromDirectory(resolvedPath);
    }

    throw new Error(`Skill path not found: ${resolvedPath}`);
  }

  /**
   * 从文件加载 Skill
   */
  private async loadFromFile(filePath: string): Promise<SkillDefinition> {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = parseSkillMd(content);

    // 从路径推断元数据
    const metadata = parsed.metadata as any;
    if (!metadata.name || metadata.name === 'unknown') {
      const inferred = inferMetadataFromPath(filePath);
      if (inferred.name) {
        parsed.metadata.name = inferred.name;
      }
    }

    return {
      metadata: parsed.metadata,
      path: filePath,
      instructions: parsed.content
    };
  }

  /**
   * 从目录加载 Skill
   */
  private async loadFromDirectory(dirPath: string): Promise<SkillDefinition> {
    const skillMdPath = join(dirPath, 'SKILL.md');

    // 检查 SKILL.md 是否存在
    try {
      await fs.access(skillMdPath);
    } catch {
      throw new Error(`SKILL.md not found in ${dirPath}`);
    }

    const content = await fs.readFile(skillMdPath, 'utf-8');
    const parsed = parseSkillMd(content);

    // 从目录名推断元数据
    const dirMetadata = parsed.metadata as any;
    if (!dirMetadata.name || dirMetadata.name === 'unknown') {
      const inferred = inferMetadataFromPath(dirPath);
      if (inferred.name) {
        parsed.metadata.name = inferred.name;
      }
    }

    // 不预加载引用文件，由模型按需读取

    return {
      metadata: parsed.metadata,
      path: dirPath,
      instructions: parsed.content
    };
  }

  
  /**
   * 加载目录下的所有 Skills
   */
  async loadAll(dirPath: string): Promise<SkillDefinition[]> {
    const resolvedPath = resolve(this.config.cwd!, dirPath);
    const skills: SkillDefinition[] = [];

    try {
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = join(resolvedPath, entry.name);

        // 应用过滤器
        if (this.config.filter && !this.config.filter(entryPath)) {
          continue;
        }

        try {
          if (entry.isDirectory()) {
            // 检查是否是 Skill 目录
            const hasSkillMd = await this.hasFile(entryPath, 'SKILL.md');
            if (hasSkillMd) {
              const skill = await this.loadFromDirectory(entryPath);
              skills.push(skill);
            }
          } else if (entry.name.endsWith('.md') && entry.name !== 'SKILL.md') {
            // 加载独立的 .md 文件作为 Skill
            const skill = await this.loadFromFile(entryPath);
            skills.push(skill);
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          if (this.config.sdkLog) {
            emitSDKLog({
              logger: this.config.sdkLog.logger,
              logLevel: this.config.sdkLog.logLevel,
              redaction: this.config.sdkLog.redaction,
              level: 'warn',
              event: {
                component: 'skill',
                event: 'skill.load.entry.error',
                message: 'Failed to load skill entry from disk',
                operation: 'skill_load',
                cwd: this.config.cwd,
                errorName: err.name,
                errorMessage: err.message,
                metadata: { path: entryPath }
              }
            });
          } else {
            console.warn(`Failed to load skill from ${entryPath}:`, error);
          }
        }
      }
    } catch {
      // 目录不存在
    }

    return skills;
  }

  /**
   * 检查文件是否存在
   */
  private async hasFile(dirPath: string, fileName: string): Promise<boolean> {
    try {
      await fs.access(join(dirPath, fileName));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取路径类型
   */
  private async getPathType(path: string): Promise<'file' | 'directory' | null> {
    try {
      const stat = await fs.stat(path);
      if (stat.isFile()) return 'file';
      if (stat.isDirectory()) return 'directory';
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * 创建 Skill 加载器
 */
export function createSkillLoader(config?: SkillLoaderConfig): SkillLoader {
  return new SkillLoader(config);
}
