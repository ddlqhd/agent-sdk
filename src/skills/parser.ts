import type { SkillMetadata, ParsedSkill } from '../core/types.js';

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
    metadata = parseSimpleYaml(yamlContent);
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
 * 简单的 YAML 解析器
 * 仅支持基本的 key: value 格式
 */
function parseSimpleYaml(yaml: string): SkillMetadata {
  const metadata: SkillMetadata = {
    name: 'unknown',
    description: ''
  };

  const lines = yaml.split('\n');
  let currentKey: string | null = null;
  let currentArray: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 数组项
    if (trimmed.startsWith('- ')) {
      if (currentKey && currentArray) {
        currentArray.push(trimmed.slice(2).replace(/^["']|["']$/g, ''));
      }
      continue;
    }

    // 处理上一个数组
    if (currentKey && currentArray.length > 0) {
      (metadata as any)[currentKey] = currentArray;
      currentArray = [];
      currentKey = null;
    }

    // key: value
    const match = trimmed.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      
      // 检查是否是数组开始
      if (value === '' || value === '[]') {
        currentKey = key;
        currentArray = [];
        if (value === '[]') {
          (metadata as any)[key] = [];
          currentKey = null;
        }
      } else {
        // 标量值
        let parsedValue: string | string[] | boolean = value.replace(/^["']|["']$/g, '');
        
        // 处理布尔值
        if (parsedValue === 'true') {
          parsedValue = true;
        } else if (parsedValue === 'false') {
          parsedValue = false;
        } else if (parsedValue.startsWith('[') && parsedValue.endsWith(']')) {
          // 处理引号包裹的字符串数组
          parsedValue = parsedValue.slice(1, -1)
            .split(',')
            .map(s => s.trim().replace(/^["']|["']$/g, ''));
        }
        
        (metadata as any)[key] = parsedValue;
      }
    }
  }

  // 处理最后一个数组
  if (currentKey && currentArray.length > 0) {
    (metadata as any)[currentKey] = currentArray;
  }

  return metadata;
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
