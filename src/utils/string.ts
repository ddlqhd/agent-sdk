/**
 * True when `value` is a string that contains at least one non-whitespace character.
 */
export function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
