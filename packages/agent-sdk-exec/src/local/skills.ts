import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { FileSystem, SkillListItem, SkillScope } from '../environment.js';
import { userSkillsRoot, workspaceSkillsRoot } from '../path-guard.js';

interface SkillFrontmatter {
  name?: string;
  description?: string;
  argumentHint?: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/**
 * SKILL.md frontmatter parser. Field names match agent-sdk `yaml-metadata.ts`.
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter {
  const lines = content.split(/\r?\n/);
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') {
      if (start === -1) {
        start = i;
      } else {
        end = i;
        break;
      }
    }
  }
  if (start === -1 || end === -1) {
    return {};
  }

  try {
    const parsed = parseYaml(lines.slice(start + 1, end).join('\n'), { schema: 'core' });
    if (!isPlainObject(parsed)) {
      return {};
    }
    const result: SkillFrontmatter = {};
    const name = toOptionalString(parsed.name);
    if (name !== undefined) {
      result.name = name;
    }
    const description = toOptionalString(parsed.description);
    if (description !== undefined) {
      result.description = description;
    }
    const argumentHint = toOptionalString(parsed.argumentHint);
    if (argumentHint !== undefined) {
      result.argumentHint = argumentHint;
    }
    if (typeof parsed.userInvocable === 'boolean') {
      result.userInvocable = parsed.userInvocable;
    }
    if (typeof parsed.disableModelInvocation === 'boolean') {
      result.disableModelInvocation = parsed.disableModelInvocation;
    }
    return result;
  } catch {
    return {};
  }
}

async function listSkillsUnderRoot(
  fs: FileSystem,
  root: string,
  scope: SkillScope
): Promise<SkillListItem[]> {
  let entries;
  try {
    entries = await fs.readDir(root);
  } catch {
    return [];
  }

  const skills: SkillListItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory) {
      continue;
    }
    const skillMd = path.join(root, entry.name, 'SKILL.md');
    try {
      const text = await fs.readText(skillMd);
      const body = text.text ?? text.lines.join('\n');
      const meta = parseSkillFrontmatter(body);
      const name = meta.name && meta.name !== 'unknown' ? meta.name : entry.name;
      const item: SkillListItem = {
        name,
        description: meta.description ?? '',
        path: skillMd,
        scope
      };
      if (meta.argumentHint !== undefined) {
        item.argumentHint = meta.argumentHint;
      }
      if (meta.userInvocable !== undefined) {
        item.userInvocable = meta.userInvocable;
      }
      if (meta.disableModelInvocation !== undefined) {
        item.disableModelInvocation = meta.disableModelInvocation;
      }
      skills.push(item);
    } catch {
      // skip unreadable or missing SKILL.md
    }
  }
  return skills;
}

export async function listSkillsFromRoots(
  fs: FileSystem,
  options: { userHome?: string; cwd: string; workspaceSkillsPath?: string }
): Promise<SkillListItem[]> {
  const skills: SkillListItem[] = [];
  const seen = new Set<string>();
  const roots: Array<{ root: string; scope: SkillScope }> = [];
  if (options.userHome) {
    roots.push({ root: userSkillsRoot(options.userHome), scope: 'user' });
  }
  roots.push({
    root: options.workspaceSkillsPath
      ? path.resolve(options.workspaceSkillsPath)
      : workspaceSkillsRoot(options.cwd),
    scope: 'workspace'
  });

  for (const { root, scope } of roots) {
    const listed = await listSkillsUnderRoot(fs, root, scope);
    for (const skill of listed) {
      if (seen.has(skill.name)) {
        continue;
      }
      seen.add(skill.name);
      skills.push(skill);
    }
  }
  return skills;
}
