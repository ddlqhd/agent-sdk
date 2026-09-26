/**
 * Shared helpers for Agent Studio console logging (truncation / previews).
 */

export function truncateForLog(s: string, max = 120): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** Host only, so userinfo embedded in a base URL never reaches logs. */
export function baseUrlForLog(value: string): string {
  try {
    const host = new URL(value).host;
    return host || '(invalid)';
  } catch {
    return '(invalid)';
  }
}

/** Log label for a configure baseUrl: host, `(cleared)`, or `(default)`. */
export function formatBaseUrlForLog(baseUrl: string | null | undefined): string {
  if (typeof baseUrl === 'string' && baseUrl.trim()) return baseUrlForLog(baseUrl);
  if (baseUrl === null) return '(cleared)';
  return '(default)';
}

/**
 * Mask a stored API key for UI hints. Values shorter than 8 characters stay fully hidden.
 * @param apiKey - Plaintext key
 * @returns A hint such as `…ab12`, never the original key
 */
export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length < 8) return '••••';
  return `…${trimmed.slice(-4)}`;
}

export function chatPreview(text: string, max = 120): { len: number; preview: string } {
  return { len: text.length, preview: truncateForLog(text, max) };
}
