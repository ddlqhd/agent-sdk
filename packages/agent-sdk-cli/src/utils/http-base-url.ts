/** Model API base URLs are short; reject anything a settings field should not store. */
export const MAX_HTTP_BASE_URL_LENGTH = 2048;

/**
 * Accept an http(s) base URL with no userinfo.
 * @param value - Raw URL string
 * @returns Trimmed URL, or undefined when empty or not allowed
 */
export function normalizeHttpBaseUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_HTTP_BASE_URL_LENGTH) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    if (parsed.username !== '' || parsed.password !== '') return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}
