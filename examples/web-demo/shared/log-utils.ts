/**
 * Shared helpers for web-demo console logging (truncation / previews).
 */

export function truncateForLog(s: string, max = 120): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function chatPreview(text: string, max = 120): { len: number; preview: string } {
  return { len: text.length, preview: truncateForLog(text, max) };
}
