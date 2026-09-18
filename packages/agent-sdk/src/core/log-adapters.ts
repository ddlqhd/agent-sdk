import { formatSDKLog } from './logger.js';
import type { LogEvent, SDKLogger } from './types.js';

/**
 * Logger shape used by OpenAI / Anthropic SDKs and most Node logging libraries.
 */
export type MessageLogger = {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
};

function writeMessageLog(
  base: MessageLogger,
  level: keyof MessageLogger,
  event: LogEvent
): void {
  const line = formatSDKLog(event);
  base[level](line, event);
}

/**
 * Bridge a message-style logger (pino, winston, console, etc.) to {@link SDKLogger}.
 */
export function adaptMessageLogger(base: MessageLogger): SDKLogger {
  return {
    debug(event) {
      writeMessageLog(base, 'debug', event);
    },
    info(event) {
      writeMessageLog(base, 'info', event);
    },
    warn(event) {
      writeMessageLog(base, 'warn', event);
    },
    error(event) {
      writeMessageLog(base, 'error', event);
    }
  };
}

/**
 * Bridge the global `console` (or a provided console-like object) to {@link SDKLogger}.
 */
export function adaptConsoleLogger(
  base: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> = console
): SDKLogger {
  return adaptMessageLogger({
    debug: (message, ...args) => base.debug(message, ...args),
    info: (message, ...args) => base.info(message, ...args),
    warn: (message, ...args) => base.warn(message, ...args),
    error: (message, ...args) => base.error(message, ...args)
  });
}
