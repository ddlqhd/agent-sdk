import type { SubagentProfile } from './types.js';
import { parseSimpleYamlFrontmatter } from './yaml-frontmatter.js';

export interface ParsedSubagentMd {
  metadata: Record<string, unknown>;
  content: string;
}

/**
 * Parse a subagent markdown file: YAML frontmatter + body (system prompt).
 */
export function parseSubagentMd(content: string): ParsedSubagentMd {
  const lines = content.split('\n');
  let metadataStartIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = i === 0 ? lines[i].replace(/^\uFEFF/, '') : lines[i];
    if (!line.trim()) continue;
    if (line.trim() === '---') {
      metadataStartIndex = i;
    }
    break;
  }

  let metadata: Record<string, unknown> = {};
  let bodyContent = content;

  if (metadataStartIndex !== -1) {
    let metadataEndIndex = -1;
    for (let i = metadataStartIndex + 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        metadataEndIndex = i;
        break;
      }
    }
    if (metadataEndIndex === -1) {
      return { metadata, content: bodyContent };
    }
    const yamlContent = lines.slice(metadataStartIndex + 1, metadataEndIndex).join('\n');
    metadata = parseSimpleYamlFrontmatter(yamlContent);
    bodyContent = lines.slice(metadataEndIndex + 1).join('\n').trim();
  }

  return { metadata, content: bodyContent };
}

function toStringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
  return undefined;
}

function inferNameFromPath(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? 'subagent';
  return base.replace(/\.md$/i, '').replace(/\s+/g, '-').toLowerCase();
}

/**
 * Build {@link SubagentProfile} from parsed markdown + path.
 */
export function metadataToSubagentProfile(
  metadata: Record<string, unknown>,
  body: string,
  filePath: string
): SubagentProfile {
  const name =
    typeof metadata.name === 'string' && metadata.name.trim()
      ? metadata.name.trim().toLowerCase()
      : inferNameFromPath(filePath);

  const description =
    typeof metadata.description === 'string' && metadata.description.trim()
      ? metadata.description.trim()
      : '';

  const promptBody = body.trim() || undefined;

  const tools = toStringList(metadata.tools);
  const disallowedTools = toStringList(metadata.disallowedTools);

  const profile: SubagentProfile = {
    name,
    description,
    promptBody,
    ...(tools !== undefined ? { tools } : {}),
    ...(disallowedTools !== undefined ? { disallowedTools } : {}),
    source: 'file',
    filePath
  };

  if (typeof metadata.model === 'string' && metadata.model.trim()) {
    profile.model = metadata.model.trim();
  }
  if (typeof metadata.permissionMode === 'string' && metadata.permissionMode.trim()) {
    profile.permissionMode = metadata.permissionMode.trim();
  }
  const maxTurnsRaw = metadata.maxTurns;
  if (typeof maxTurnsRaw === 'number' && Number.isFinite(maxTurnsRaw) && maxTurnsRaw > 0) {
    profile.maxTurns = Math.floor(maxTurnsRaw);
  } else if (typeof maxTurnsRaw === 'string' && maxTurnsRaw.trim()) {
    const n = parseInt(maxTurnsRaw.trim(), 10);
    if (Number.isFinite(n) && n > 0) profile.maxTurns = n;
  }
  if (metadata.skills !== undefined) {
    const s = toStringList(metadata.skills);
    if (s?.length) profile.skills = s;
  }
  if (metadata.mcpServers !== undefined) {
    profile.mcpServers = metadata.mcpServers;
  }
  if (metadata.hooks !== undefined) {
    profile.hooks = metadata.hooks;
  }
  if (typeof metadata.memory === 'string' && metadata.memory.trim()) {
    profile.memory = metadata.memory.trim();
  }
  if (metadata.background === true || metadata.background === false) {
    profile.background = metadata.background;
  }
  if (typeof metadata.initialPrompt === 'string' && metadata.initialPrompt.trim()) {
    profile.initialPrompt = metadata.initialPrompt.trim();
  }

  return profile;
}
