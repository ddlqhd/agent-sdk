import {
  SLASH_COMMANDS,
  matchSlashCommandsByPrefix,
  resolveSlashCommandName
} from '../utils/slash-registry.js';

export interface SlashMenuItem {
  key: string;
  label: string;
  description: string;
  insertText: string;
  kind: 'builtin' | 'skill';
}

export interface SlashMenuSkill {
  name: string;
  description: string;
  argumentHint?: string;
}

function builtinInsertText(name: string): string {
  return `/${name} `;
}

export function buildSlashMenuItems(skills: SlashMenuSkill[]): SlashMenuItem[] {
  const builtinNames = new Set(SLASH_COMMANDS.map((c) => c.name));
  const items: SlashMenuItem[] = SLASH_COMMANDS.map((c) => ({
    key: `builtin:${c.name}`,
    label: `/${c.name}`,
    description: c.description,
    insertText: builtinInsertText(c.name),
    kind: 'builtin' as const
  }));

  for (const skill of skills) {
    if (builtinNames.has(skill.name)) continue;
    const desc = skill.argumentHint
      ? `${skill.description} (${skill.argumentHint})`
      : skill.description;
    items.push({
      key: `skill:${skill.name}`,
      label: `/${skill.name}`,
      description: desc,
      insertText: `/${skill.name} `,
      kind: 'skill'
    });
  }

  return items;
}

export function slashMenuVisible(input: string): boolean {
  if (!input.startsWith('/')) return false;
  return /^\/\S*$/.test(input);
}

export function filterSlashMenuItems(items: SlashMenuItem[], input: string): SlashMenuItem[] {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return [];
  const prefix = trimmed.slice(1).toLowerCase();
  if (!prefix) return items;

  const builtinMatches = new Set(matchSlashCommandsByPrefix(prefix).map((c) => c.name));

  return items.filter((item) => {
    if (item.kind === 'skill') {
      return item.label.slice(1).toLowerCase().startsWith(prefix);
    }
    return builtinMatches.has(item.label.slice(1));
  });
}

export const SLASH_MENU_MAX_VISIBLE = 8;

/** Compute a sliding window so selectedIndex stays visible when list exceeds maxVisible. */
export function computeSlashMenuWindow(
  total: number,
  selectedIndex: number,
  maxVisible = SLASH_MENU_MAX_VISIBLE
): { start: number; end: number; above: number; below: number } {
  if (total <= maxVisible) {
    return { start: 0, end: total, above: 0, below: 0 };
  }
  const maxStart = total - maxVisible;
  const start = Math.min(Math.max(0, selectedIndex - maxVisible + 1), maxStart);
  const end = start + maxVisible;
  return { start, end, above: start, below: total - end };
}

/** Hide dropdown when user has typed an exact unique command name (classic parity). */
export function slashMenuDropdownOpen(input: string, filtered: SlashMenuItem[]): boolean {
  if (!slashMenuVisible(input)) return false;
  if (filtered.length === 0) return true;
  const prefix = input.slice(1).toLowerCase();
  if (filtered.length === 1) {
    const only = filtered[0]!;
    const name = only.label.slice(1).toLowerCase();
    if (name === prefix) return false;
    const resolved = resolveSlashCommandName(prefix);
    if (resolved && resolved === name) return false;
  }
  return true;
}
