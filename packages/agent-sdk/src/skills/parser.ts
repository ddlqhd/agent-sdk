import type { SkillMetadata, ParsedSkill } from '../core/types.js';
import { normalizeSkillMetadata, parseYamlFrontmatter } from './yaml-metadata.js';

/**
 * 解析 SKILL.md 文件
 * 格式：
 * ---
 * name: skill-name
 * description: "Skill description"
 * version: "1.0.0"
 * ---
 *
 * # Instructions
 * ...
 */
export function parseSkillMd(content: string): ParsedSkill {
  const lines = content.split('\n');
  let metadataEndIndex = -1;
  let metadataStartIndex = -1;

  // 查找 YAML frontmatter
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '---') {
      if (metadataStartIndex === -1) {
        metadataStartIndex = i;
      } else {
        metadataEndIndex = i;
        break;
      }
    }
  }

  let metadata: SkillMetadata = {
    name: 'unknown',
    description: ''
  };

  let bodyContent = content;

  // 解析 YAML frontmatter
  if (metadataStartIndex !== -1 && metadataEndIndex !== -1) {
    const yamlContent = lines.slice(metadataStartIndex + 1, metadataEndIndex).join('\n');
    const raw = parseYamlFrontmatter(yamlContent);
    metadata = normalizeSkillMetadata(raw);
    bodyContent = lines.slice(metadataEndIndex + 1).join('\n').trim();
  }

  // 如果没有名字，从第一个标题推断
  if (metadata.name === 'unknown') {
    const titleMatch = bodyContent.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      metadata.name = titleMatch[1].toLowerCase().replace(/\s+/g, '-');
    }
  }

  return {
    metadata,
    content: bodyContent
  };
}

/**
 * 验证 Skill 元数据
 */
export function validateMetadata(metadata: Partial<SkillMetadata>): metadata is SkillMetadata {
  return typeof metadata.name === 'string' && metadata.name !== 'unknown';
}

/**
 * 从目录结构推断 Skill 元数据
 */
export function inferMetadataFromPath(skillPath: string): Partial<SkillMetadata> {
  const pathParts = skillPath.replace(/\\/g, '/').split('/');
  const dirName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

  return {
    name: dirName
  };
}
