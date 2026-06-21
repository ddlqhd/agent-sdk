import { parse as parseYaml } from 'yaml';
import type { SkillMetadata } from '../core/types.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
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

function toOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Parse YAML frontmatter from SKILL.md using the standard `yaml` library.
 */
export function parseYamlFrontmatter(yaml: string): Record<string, unknown> {
  const trimmed = yaml.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = parseYaml(trimmed, { schema: 'core' });
    if (parsed === null || parsed === undefined) {
      return {};
    }
    if (!isPlainObject(parsed)) {
      throw new Error('YAML frontmatter must be a mapping object');
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML frontmatter in SKILL.md: ${message}`);
  }
}

/**
 * Map parsed YAML values to {@link SkillMetadata}, ignoring unknown fields.
 */
export function normalizeSkillMetadata(raw: Record<string, unknown>): SkillMetadata {
  const name = toOptionalString(raw.name) ?? 'unknown';
  const description = toOptionalString(raw.description) ?? '';

  const metadata: SkillMetadata = {
    name,
    description
  };

  const version = toOptionalString(raw.version);
  if (version !== undefined) {
    metadata.version = version;
  }

  const author = toOptionalString(raw.author);
  if (author !== undefined) {
    metadata.author = author;
  }

  const dependencies = toStringList(raw.dependencies);
  if (dependencies !== undefined) {
    metadata.dependencies = dependencies;
  }

  const tags = toStringList(raw.tags);
  if (tags !== undefined) {
    metadata.tags = tags;
  }

  const argumentHint = toOptionalString(raw.argumentHint);
  if (argumentHint !== undefined) {
    metadata.argumentHint = argumentHint;
  }

  const disableModelInvocation = toOptionalBoolean(raw.disableModelInvocation);
  if (disableModelInvocation !== undefined) {
    metadata.disableModelInvocation = disableModelInvocation;
  }

  const userInvocable = toOptionalBoolean(raw.userInvocable);
  if (userInvocable !== undefined) {
    metadata.userInvocable = userInvocable;
  }

  return metadata;
}
