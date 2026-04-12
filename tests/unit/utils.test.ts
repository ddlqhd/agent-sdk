import { describe, it, expect } from 'vitest';
import { isNonBlankString } from '../../src/utils/index.js';

describe('isNonBlankString', () => {
  it('returns true for strings with non-whitespace', () => {
    expect(isNonBlankString('a')).toBe(true);
    expect(isNonBlankString('  x  ')).toBe(true);
  });

  it('returns false for empty, whitespace-only, or non-strings', () => {
    expect(isNonBlankString('')).toBe(false);
    expect(isNonBlankString('   \t')).toBe(false);
    expect(isNonBlankString(undefined)).toBe(false);
    expect(isNonBlankString(null)).toBe(false);
    expect(isNonBlankString(1)).toBe(false);
  });
});
