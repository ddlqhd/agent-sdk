import { homedir } from 'node:os';
import { join } from 'node:path';
import { createFileJSONLLogger, type FileJSONLLogger } from '../../core/file-logger.js';
import type { SDKLogLevel } from '../../core/types.js';

const LEVELS: SDKLogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

/**
 * Parses `--log-level` for chat/-p. Throws on invalid values (Commander will surface).
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
  return `Agent SDK log level (${LEVELS.join('|')}; default for chat/-p: ${DEFAULT_CLI_AGENT_LOG_LEVEL})`;
}

/** YYYY-MM-DD in local time, used for the daily JSONL file name. */
function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Default JSONL log file path used by the CLI when neither `--log-file` nor
 * `AGENT_SDK_LOG_FILE` is provided. Mirrors the session-storage convention of
 * placing per-user state under `<userBase>/.claude/...`.
 */
export function getDefaultCliLogPath(userBasePath?: string): string {
  const base = userBasePath && userBasePath.trim() !== '' ? userBasePath : homedir();
  return join(base, '.claude', 'logs', `agent-sdk-${todayStamp()}.log`);
}

/**
 * Resolve the effective log file path. Precedence:
 * 1. Explicit `--log-file` flag.
 * 2. `AGENT_SDK_LOG_FILE` environment variable.
 * 3. {@link getDefaultCliLogPath}.
 */
export function resolveCliLogFile(
  cliFlag: string | undefined,
  userBasePath: string | undefined
): string {
  const fromFlag = cliFlag && cliFlag.trim() !== '' ? cliFlag.trim() : undefined;
  const fromEnv = process.env.AGENT_SDK_LOG_FILE && process.env.AGENT_SDK_LOG_FILE.trim() !== ''
    ? process.env.AGENT_SDK_LOG_FILE.trim()
    : undefined;
  return fromFlag ?? fromEnv ?? getDefaultCliLogPath(userBasePath);
}

/**
 * Build the JSONL file logger for CLI commands. Returns `null` when `level === 'silent'`,
 * in which case no file is opened.
 */
export function createCliFileLogger(
  level: SDKLogLevel,
  cliFlag: string | undefined,
  userBasePath: string | undefined
): FileJSONLLogger | null {
  if (level === 'silent') return null;
  const filePath = resolveCliLogFile(cliFlag, userBasePath);
  return createFileJSONLLogger({ filePath });
}
