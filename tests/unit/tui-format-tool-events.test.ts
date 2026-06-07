import { describe, it, expect } from 'vitest';
import {
  formatToolCallText,
  formatToolResultText,
  formatToolErrorText
} from '../../src/cli/tui/format-tool-events.js';

describe('formatToolCallText', () => {
  it('formats compact call line', () => {
    const text = formatToolCallText(false, 'tc1', 'Read', { file_path: '/a' });
    expect(text).toContain('🔧 Read');
    expect(text).toContain('[tc1]');
    expect(text).toContain('file_path');
  });

  it('formats verbose call with expanded args', () => {
    const text = formatToolCallText(true, 'tc1', 'Read', { file_path: '/a' });
    expect(text).toContain('🔧 Read');
    expect(text).toContain('[tc1]');
    expect(text).toContain('\n');
  });
});

describe('formatToolResultText', () => {
  it('truncates result when not verbose', () => {
    const long = 'x'.repeat(200);
    const text = formatToolResultText(false, 'tc1', long);
    expect(text.startsWith('✓ [tc1] ')).toBe(true);
    expect(text.length).toBeLessThan(long.length);
  });

  it('shows full result when verbose', () => {
    const text = formatToolResultText(true, 'tc1', 'full body');
    expect(text).toBe('✓ [tc1] Result:\nfull body');
  });
});

describe('formatToolErrorText', () => {
  it('formats compact error', () => {
    const text = formatToolErrorText(false, 'tc1', new Error('boom'));
    expect(text).toBe('✗ [tc1] boom');
  });

  it('formats verbose error', () => {
    const text = formatToolErrorText(true, 'tc1', new Error('boom'));
    expect(text).toBe('✗ [tc1] Error:\nboom');
  });
});
