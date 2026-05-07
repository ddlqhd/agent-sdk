/**
 * Minimal YAML frontmatter parser for subagent files (scalars, arrays, booleans).
 */

export function parseSimpleYamlFrontmatter(yaml: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([\w-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, value] = match;
    const parsed = parseScalarValue(value);

    if (parsed === '__BLOCK_LITERAL__' || parsed === '__BLOCK_FOLDED__') {
      const blockLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextRaw = lines[j];
        const nextTrimmed = nextRaw.trim();
        if (!nextTrimmed) {
          blockLines.push('');
          j++;
          continue;
        }
        if (/^\s/.test(nextRaw)) {
          blockLines.push(nextRaw.replace(/^\s+/, ''));
          j++;
          continue;
        }
        break;
      }
      metadata[key] = parsed === '__BLOCK_FOLDED__' ? foldBlockLines(blockLines) : blockLines.join('\n');
      i = j - 1;
      continue;
    }

    if (parsed === '__ARRAY_CANDIDATE__') {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextRaw = lines[j];
        const nextTrimmed = nextRaw.trim();
        if (!nextTrimmed || nextTrimmed.startsWith('#')) {
          j++;
          continue;
        }
        if (/^\s*-\s+/.test(nextRaw)) {
          items.push(nextTrimmed.slice(2).replace(/^["']|["']$/g, ''));
          j++;
          continue;
        }
        break;
      }
      if (items.length > 0) {
        metadata[key] = items;
        i = j - 1;
      } else {
        metadata[key] = '';
      }
      continue;
    }

    metadata[key] = parsed;
  }

  return metadata;
}

function parseScalarValue(value: string): unknown {
  if (value === '[]') {
    return [];
  }
  if (value === '|') {
    return '__BLOCK_LITERAL__';
  }
  if (value === '>') {
    return '__BLOCK_FOLDED__';
  }
  if (value === '') {
    return '__ARRAY_CANDIDATE__';
  }

  const stripped = value.replace(/^["']|["']$/g, '');
  if (stripped === 'true') {
    return true;
  }
  if (stripped === 'false') {
    return false;
  }
  if (stripped.startsWith('[') && stripped.endsWith(']')) {
    return stripped
      .slice(1, -1)
      .split(',')
      .map(s => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  return stripped;
}

function foldBlockLines(lines: string[]): string {
  const out: string[] = [];
  for (const line of lines) {
    if (!line) {
      out.push('\n');
    } else if (out.length === 0 || out[out.length - 1] === '\n') {
      out.push(line);
    } else {
      out.push(` ${line}`);
    }
  }
  return out.join('');
}
