import { describe, it, expect } from 'vitest';
import {
  summarizeToolArgs,
  formatToolCallText,
  formatToolResultText,
  formatToolErrorText,
  isPersistedToolErrorContent,
  toolLineFromPersistedToolMessage
} from '../../src/cli/tui/format-tool-events.js';

describe('summarizeToolArgs', () => {
  it('extracts file_path for Read', () => {
    expect(summarizeToolArgs('Read', { file_path: '/a/b.ts' })).toBe('/a/b.ts');
  });

  it('falls back to path when file_path is absent', () => {
    expect(summarizeToolArgs('Read', { path: '/a' })).toBe('/a');
  });

  it('stringifies unknown args', () => {
    expect(summarizeToolArgs('Custom', { foo: 1 })).toContain('foo');
  });
});

describe('formatToolCallText', () => {
  it('formats OpenCode-style compact call line', () => {
    const text = formatToolCallText(false, 'Read', { file_path: '/a' });
    expect(text).toBe('Read: /a');
    expect(text).not.toContain('🔧');
  });

  it('formats verbose call with expanded args', () => {
    const text = formatToolCallText(true, 'Read', { file_path: '/a' });
    expect(text).toContain('Read:');
    expect(text).toContain('\n');
    expect(text).toContain('file_path');
  });
});

describe('formatToolResultText', () => {
  it('truncates result when not verbose', () => {
    const long = 'x'.repeat(200);
    const text = formatToolResultText(false, long);
    expect(text).not.toContain('✓');
    expect(text.length).toBeLessThan(long.length);
  });

  it('shows full result when verbose', () => {
    const text = formatToolResultText(true, 'full body');
    expect(text).toBe('full body');
  });
});

describe('formatToolErrorText', () => {
  it('formats compact error', () => {
    const text = formatToolErrorText(false, new Error('boom'));
    expect(text).toBe('Error: boom');
  });

  it('formats verbose error', () => {
    const text = formatToolErrorText(true, new Error('boom'));
    expect(text).toBe('Error:\nboom');
  });
});

describe('toolLineFromPersistedToolMessage', () => {
  it('detects agent-persisted error prefix', () => {
    expect(isPersistedToolErrorContent('Error: file missing')).toBe(true);
    expect(isPersistedToolErrorContent('file body')).toBe(false);
  });

  it('maps persisted errors to toolKind error', () => {
    const line = toolLineFromPersistedToolMessage(false, 'Error: file missing');
    expect(line.toolKind).toBe('error');
    expect(line.text).toBe('Error: file missing');
  });

  it('maps success content to toolKind result', () => {
    const line = toolLineFromPersistedToolMessage(false, 'file body');
    expect(line.toolKind).toBe('result');
    expect(line.text).toBe('file body');
  });
});
