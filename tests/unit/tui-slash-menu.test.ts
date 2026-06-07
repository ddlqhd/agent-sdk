import { describe, it, expect } from 'vitest';
import {
  buildSlashMenuItems,
  computeSlashMenuWindow,
  filterSlashMenuItems,
  slashMenuVisible,
  slashMenuDropdownOpen
} from '../../src/cli/tui/slash-menu.js';

describe('slashMenuVisible', () => {
  it('shows for / and partial commands', () => {
    expect(slashMenuVisible('/')).toBe(true);
    expect(slashMenuVisible('/ch')).toBe(true);
    expect(slashMenuVisible('/unknown')).toBe(true);
  });

  it('hides when args present or not slash', () => {
    expect(slashMenuVisible('/rewind 0')).toBe(false);
    expect(slashMenuVisible('hello')).toBe(false);
    expect(slashMenuVisible('/rewind ')).toBe(false);
  });
});

describe('buildSlashMenuItems', () => {
  it('includes builtins with trailing space insertText', () => {
    const items = buildSlashMenuItems([]);
    const help = items.find((i) => i.label === '/help');
    const rewind = items.find((i) => i.label === '/rewind');
    expect(help?.insertText).toBe('/help ');
    expect(rewind?.insertText).toBe('/rewind ');
    expect(help?.kind).toBe('builtin');
  });

  it('dedupes skill when builtin name collides', () => {
    const items = buildSlashMenuItems([
      { name: 'help', description: 'skill help' },
      { name: 'my-skill', description: 'do thing', argumentHint: '<arg>' }
    ]);
    const helpItems = items.filter((i) => i.label === '/help');
    expect(helpItems).toHaveLength(1);
    expect(helpItems[0]!.kind).toBe('builtin');
    const skill = items.find((i) => i.label === '/my-skill');
    expect(skill?.kind).toBe('skill');
    expect(skill?.description).toContain('<arg>');
    expect(skill?.insertText).toBe('/my-skill ');
  });
});

describe('filterSlashMenuItems', () => {
  const items = buildSlashMenuItems([{ name: 'demo', description: 'x' }]);

  it('filters by prefix', () => {
    const filtered = filterSlashMenuItems(items, '/ch');
    expect(filtered.some((i) => i.label === '/checkpoints')).toBe(true);
    expect(filtered.every((i) => i.label.startsWith('/ch') || i.label === '/compact')).toBe(true);
  });

  it('returns all for bare /', () => {
    expect(filterSlashMenuItems(items, '/').length).toBe(items.length);
  });

  it('filters builtins by alias prefix', () => {
    expect(filterSlashMenuItems(items, '/res').some((i) => i.label === '/sessions')).toBe(true);
    expect(filterSlashMenuItems(items, '/quit').some((i) => i.label === '/exit')).toBe(true);
    expect(filterSlashMenuItems(items, '/summ').some((i) => i.label === '/compact')).toBe(true);
  });
});

describe('computeSlashMenuWindow', () => {
  it('shows full list when within max visible', () => {
    expect(computeSlashMenuWindow(5, 2)).toEqual({ start: 0, end: 5, above: 0, below: 0 });
  });

  it('scrolls window down as selection moves past bottom', () => {
    expect(computeSlashMenuWindow(14, 7)).toEqual({ start: 0, end: 8, above: 0, below: 6 });
    expect(computeSlashMenuWindow(14, 8)).toEqual({ start: 1, end: 9, above: 1, below: 5 });
    expect(computeSlashMenuWindow(14, 13)).toEqual({ start: 6, end: 14, above: 6, below: 0 });
  });
});

describe('slashMenuDropdownOpen', () => {
  const items = buildSlashMenuItems([]);

  it('hides on exact unique match', () => {
    const filtered = filterSlashMenuItems(items, '/help');
    expect(slashMenuDropdownOpen('/help', filtered)).toBe(false);
  });

  it('stays open for partial prefix', () => {
    const filtered = filterSlashMenuItems(items, '/h');
    expect(slashMenuDropdownOpen('/h', filtered)).toBe(true);
  });

  it('stays open for empty filter on unknown', () => {
    const filtered = filterSlashMenuItems(items, '/zzz');
    expect(filtered).toHaveLength(0);
    expect(slashMenuDropdownOpen('/zzz', filtered)).toBe(true);
  });
});
