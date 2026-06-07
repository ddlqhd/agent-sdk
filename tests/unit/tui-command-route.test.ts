import { describe, it, expect } from 'vitest';
import { parseTuiModalCommand } from '../../src/cli/tui/tui-command-route.js';

describe('parseTuiModalCommand', () => {
  it('maps UI-owned slash commands', () => {
    expect(parseTuiModalCommand('/help')).toBe('help');
    expect(parseTuiModalCommand('/status')).toBe('status');
    expect(parseTuiModalCommand('/session')).toBe('status');
    expect(parseTuiModalCommand('/sessions')).toBe('sessions');
    expect(parseTuiModalCommand('/checkpoints')).toBe('checkpoints');
  });

  it('returns null for commands with args or non-UI commands', () => {
    expect(parseTuiModalCommand('/rewind 0')).toBe(null);
    expect(parseTuiModalCommand('/compact')).toBe(null);
    expect(parseTuiModalCommand('hello')).toBe(null);
  });
});
