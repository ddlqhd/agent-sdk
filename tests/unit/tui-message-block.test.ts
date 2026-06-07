import { describe, it, expect } from 'vitest';
import {
  borderColorForLine,
  displayTextForLine,
  isDimLine
} from '../../src/cli/tui/message-block-styles.js';

describe('borderColorForLine', () => {
  it('maps roles and tool kinds to border colors', () => {
    expect(borderColorForLine({ role: 'user' })).toBe('gray');
    expect(borderColorForLine({ role: 'assistant' })).toBe('cyan');
    expect(borderColorForLine({ role: 'thinking' })).toBe('gray');
    expect(borderColorForLine({ role: 'tool', toolKind: 'call' })).toBe('yellow');
    expect(borderColorForLine({ role: 'tool', toolKind: 'result' })).toBe('green');
    expect(borderColorForLine({ role: 'tool', toolKind: 'error' })).toBe('red');
  });
});

describe('isDimLine', () => {
  it('dims thinking and tool results', () => {
    expect(isDimLine({ role: 'thinking' })).toBe(true);
    expect(isDimLine({ role: 'tool', toolKind: 'result' })).toBe(true);
    expect(isDimLine({ role: 'assistant' })).toBe(false);
    expect(isDimLine({ role: 'tool', toolKind: 'call' })).toBe(false);
  });
});

describe('displayTextForLine', () => {
  it('prefixes tool results with Result:', () => {
    expect(
      displayTextForLine({ role: 'tool', toolKind: 'result', text: 'file body' })
    ).toBe('Result: file body');
  });

  it('does not double-prefix', () => {
    expect(
      displayTextForLine({ role: 'tool', toolKind: 'result', text: 'Result: already' })
    ).toBe('Result: already');
  });
});
