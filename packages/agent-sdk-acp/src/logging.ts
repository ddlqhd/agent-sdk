/**
 * Route human-readable logs to stderr so stdout stays clean for ACP JSON-RPC.
 */

const originalLog = console.log.bind(console);
const originalInfo = console.info.bind(console);
const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);

function writeStderr(...args: unknown[]): void {
  originalError(...args);
}

export function installStderrLogging(): void {
  console.log = writeStderr;
  console.info = writeStderr;
  console.warn = (...args: unknown[]) => originalWarn(...args);
  console.error = (...args: unknown[]) => originalError(...args);
}

export function logInfo(message: string, detail?: string): void {
  const line = detail ? `${message} ${detail}` : message;
  originalError(`[agent-sdk-acp] ${line}`);
}

export function logError(message: string, err?: unknown): void {
  const extra =
    err instanceof Error ? `${err.message}${err.stack ? `\n${err.stack}` : ''}` : err ? String(err) : '';
  originalError(`[agent-sdk-acp] ${message}${extra ? `: ${extra}` : ''}`);
}

/** Restore default console (tests). */
export function restoreConsole(): void {
  console.log = originalLog;
  console.info = originalInfo;
  console.warn = originalWarn;
  console.error = originalError;
}
