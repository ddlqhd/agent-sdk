import { mkdirSync, createWriteStream, type WriteStream } from 'fs';
import { dirname } from 'path';
import { inspect } from 'util';
import { coerceLogEventEpochMs, formatStructuredLogWallClock } from './log-timestamp.js';
import type { LogEvent, SDKLogger } from './types.js';

export interface FileJSONLLoggerOptions {
  /** Absolute or relative path to the JSONL log file. Parent directory is created if missing. */
  filePath: string;
  /**
   * Custom serializer; defaults to a safe JSON.stringify that falls back to `util.inspect` on
   * circular references. Should NOT include a trailing newline.
   */
  serialize?: (event: LogEvent) => string;
}

export interface FileJSONLLogger extends SDKLogger {
  readonly filePath: string;
  /**
   * Ends the underlying write stream and resolves after `'finish'` (or `'error'` to avoid hanging
   * on a broken stream). Idempotent.
   */
  close(): Promise<void>;
}

function defaultSerialize(event: LogEvent): string {
  try {
    return JSON.stringify(event);
  } catch {
    return JSON.stringify({
      source: event.source,
      component: event.component,
      event: event.event,
      message: event.message,
      _fallback: inspect(event, { depth: null, breakLength: Infinity, maxArrayLength: null })
    });
  }
}

/**
 * Create an {@link SDKLogger} that appends one JSON object per line to `filePath`.
 *
 * Failures during writes are reported via `console.error` once per failure mode and do not throw,
 * so logging never blocks or crashes the host Agent loop. Each appended line carries
 * {@link LogEvent.timestamp}（与 {@link emitSDKLog} 一致的可读时间及时区）。
 */
export function createFileJSONLLogger(opts: FileJSONLLoggerOptions): FileJSONLLogger {
  const { filePath } = opts;
  const serialize = opts.serialize ?? defaultSerialize;

  let stream: WriteStream | null = null;
  let openError: Error | null = null;
  let closed = false;
  let warnedOnWriteError = false;

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    stream = createWriteStream(filePath, { flags: 'a' });
    stream.on('error', (err) => {
      if (!warnedOnWriteError) {
        warnedOnWriteError = true;
        console.error(`[agent-sdk][file-logger] write stream error for ${filePath}: ${err.message}`);
      }
    });
  } catch (err) {
    openError = err instanceof Error ? err : new Error(String(err));
    console.error(
      `[agent-sdk][file-logger] failed to open log file ${filePath}: ${openError.message}`
    );
  }

  function write(event: LogEvent): void {
    if (closed || stream == null || openError != null) {
      return;
    }
    const epochMs = coerceLogEventEpochMs(event.timestamp);
    const lineEvent: LogEvent = { ...event, timestamp: formatStructuredLogWallClock(epochMs) };
    try {
      stream.write(serialize(lineEvent) + '\n');
    } catch (err) {
      if (!warnedOnWriteError) {
        warnedOnWriteError = true;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[agent-sdk][file-logger] write failed for ${filePath}: ${msg}`);
      }
    }
  }

  return {
    filePath,
    debug: write,
    info: write,
    warn: write,
    error: write,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      const s = stream;
      stream = null;
      if (s == null) return;
      await new Promise<void>((resolve) => {
        const done = (): void => {
          resolve();
        };
        s.once('finish', done);
        s.once('error', done);
        s.end();
      });
    }
  };
}
