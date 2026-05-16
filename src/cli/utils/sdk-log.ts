import type { SDKLogLevel } from '../../core/types.js';

const LEVELS: SDKLogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

/**
 * Parses `--log-level` for chat/run. Throws on invalid values (Commander will surface).
 */
export function parseCliLogLevel(value: string): SDKLogLevel {
  const v = value.trim().toLowerCase() as SDKLogLevel;
  if (!LEVELS.includes(v)) {
    throw new Error(`Invalid --log-level "${value}". Use ${LEVELS.join(', ')}.`);
  }
  return v;
}

/** Default SDK log level when running the interactive / one-shot CLI (library default is otherwise silent). */
export const DEFAULT_CLI_AGENT_LOG_LEVEL: SDKLogLevel = 'info';

export function describeCliLogLevelOption(): string {
  return `Agent SDK log level (${LEVELS.join('|')}; default for chat/run: ${DEFAULT_CLI_AGENT_LOG_LEVEL})`;
}
