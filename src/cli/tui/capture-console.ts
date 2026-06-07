/** Strip ANSI escape codes for TUI status line display. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Redirect console.log during async work so Ink raw mode is not corrupted.
 * Collected lines are returned for display in the TUI status area.
 */
export async function withCapturedConsoleLog<T>(fn: () => Promise<T>): Promise<{
  result: T;
  logs: string[];
}> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  };
  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.log = original;
  }
}
