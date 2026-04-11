import type { LogEvent, LogRedactionConfig, SDKLogLevel, SDKLogger } from './types.js';

const TRUTHY = /^(1|true|yes)$/i;
const DEFAULT_MAX_BODY_CHARS = 4000;
const DEFAULT_REDACT_KEYS = [
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'apikey',
  'api_key',
  'cookie',
  'set-cookie',
  'token',
  'access_token',
  'refresh_token',
  'password',
  'secret'
];

const LEVEL_PRIORITY: Record<SDKLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99
};

function parseEnvLogLevel(raw: string | undefined): SDKLogLevel | undefined {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'debug':
    case 'info':
    case 'warn':
    case 'error':
    case 'silent':
      return (raw ?? '').trim().toLowerCase() as SDKLogLevel;
    default:
      return undefined;
  }
}

function parseBooleanEnv(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw == null || raw === '') {
    return undefined;
  }
  if (TRUTHY.test(raw.trim())) {
    return true;
  }
  if (/^(0|false|no)$/i.test(raw.trim())) {
    return false;
  }
  return undefined;
}

function parseNumericEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw == null || raw === '') {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function resolveSDKLogLevel(level?: SDKLogLevel, hasLogger = false): SDKLogLevel {
  if (level != null) {
    return level;
  }
  const fromEnv = parseEnvLogLevel(process.env.AGENT_SDK_LOG_LEVEL);
  if (fromEnv != null) {
    return fromEnv;
  }
  if (hasLogger) {
    return 'info';
  }
  return 'silent';
}

export function resolveLogRedaction(config?: LogRedactionConfig): Required<LogRedactionConfig> {
  const envIncludeBodies = parseBooleanEnv('AGENT_SDK_LOG_BODIES');
  const envIncludeToolArgs = parseBooleanEnv('AGENT_SDK_LOG_INCLUDE_TOOL_ARGS');
  const envMaxBodyChars = parseNumericEnv('AGENT_SDK_LOG_MAX_BODY_CHARS');

  return {
    includeBodies: config?.includeBodies ?? envIncludeBodies ?? false,
    includeToolArguments: config?.includeToolArguments ?? envIncludeToolArgs ?? false,
    maxBodyChars: Math.max(
      0,
      Math.floor(config?.maxBodyChars ?? envMaxBodyChars ?? DEFAULT_MAX_BODY_CHARS)
    ),
    redactKeys: [
      ...DEFAULT_REDACT_KEYS,
      ...(config?.redactKeys ?? [])
    ]
  };
}

export function shouldEmitLog(
  configuredLevel: SDKLogLevel | undefined,
  hasLogger: boolean,
  eventLevel: Exclude<SDKLogLevel, 'silent'>
): boolean {
  const effectiveLevel = resolveSDKLogLevel(configuredLevel, hasLogger);
  return LEVEL_PRIORITY[eventLevel] >= LEVEL_PRIORITY[effectiveLevel];
}

function truncateString(value: string, maxChars: number): string {
  if (maxChars <= 0 || value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}... [truncated ${value.length - maxChars} chars]`;
}

function isSensitiveKey(key?: string, redaction?: Required<LogRedactionConfig>): boolean {
  if (key == null || redaction == null) {
    return false;
  }
  const normalized = key.toLowerCase();
  return redaction.redactKeys.some(candidate => candidate.toLowerCase() === normalized);
}

function sanitizeObjectEntries(
  entries: Array<[string, unknown]>,
  redaction: Required<LogRedactionConfig>
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (isSensitiveKey(key, redaction)) {
      output[key] = '[REDACTED]';
      continue;
    }
    if (key === 'messages' && !redaction.includeBodies && Array.isArray(value)) {
      output[key] = `[REDACTED_MESSAGES:${value.length}]`;
      continue;
    }
    if ((key === 'arguments' || key === 'input') && !redaction.includeToolArguments) {
      output[key] = '[REDACTED_TOOL_ARGUMENTS]';
      continue;
    }
    output[key] = sanitizeForLogging(value, redaction, key);
  }
  return output;
}

export function sanitizeForLogging(
  value: unknown,
  redaction: Required<LogRedactionConfig>,
  key?: string
): unknown {
  if (isSensitiveKey(key, redaction)) {
    return '[REDACTED]';
  }

  if (typeof value === 'string') {
    if (!redaction.includeBodies && (key === 'content' || key === 'text' || key === 'thinking')) {
      return '[REDACTED_BODY]';
    }
    return truncateString(value, redaction.maxBodyChars);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    if (!redaction.includeBodies && key === 'messages') {
      return `[REDACTED_MESSAGES:${value.length}]`;
    }
    return value.map(item => sanitizeForLogging(item, redaction));
  }

  if (typeof value === 'object') {
    return sanitizeObjectEntries(Object.entries(value as Record<string, unknown>), redaction);
  }

  return String(value);
}

export function formatSDKLog(event: LogEvent): string {
  const prefix = `[agent-sdk][${event.component}][${event.event}]`;
  const details: string[] = [];

  if (event.provider) details.push(`provider=${event.provider}`);
  if (event.model) details.push(`model=${event.model}`);
  if (event.sessionId) details.push(`sessionId=${event.sessionId}`);
  if (event.iteration !== undefined) details.push(`iteration=${event.iteration}`);
  if (event.statusCode !== undefined) details.push(`statusCode=${event.statusCode}`);
  if (event.durationMs !== undefined) details.push(`durationMs=${event.durationMs}`);
  if (event.toolName) details.push(`tool=${event.toolName}`);
  if (event.requestId) details.push(`requestId=${event.requestId}`);
  if (event.clientRequestId) details.push(`clientRequestId=${event.clientRequestId}`);

  const suffix = details.length > 0 ? ` ${details.join(' ')}` : '';
  return event.message ? `${prefix} ${event.message}${suffix}` : `${prefix}${suffix}`;
}

function consoleMethod(level: Exclude<SDKLogLevel, 'silent'>): (...args: unknown[]) => void {
  if (level === 'error') return console.error.bind(console);
  if (level === 'warn') return console.warn.bind(console);
  if (level === 'info') return console.info.bind(console);
  return console.debug.bind(console);
}

export function createConsoleSDKLogger(): SDKLogger {
  const write = (
    level: Exclude<SDKLogLevel, 'silent'>,
    event: LogEvent
  ): void => {
    const line = formatSDKLog(event);
    const logFn = consoleMethod(level);
    if (event.metadata != null) {
      logFn(line, event.metadata);
    } else {
      logFn(line);
    }
  };

  return {
    debug(event) {
      write('debug', event);
    },
    info(event) {
      write('info', event);
    },
    warn(event) {
      write('warn', event);
    },
    error(event) {
      write('error', event);
    }
  };
}

/**
 * 发出一条 SDK 日志。若未传入 `logger` 且当前级别允许输出，则使用内置的 {@link createConsoleSDKLogger}
 * 写到 `console`（级别对应 `console.debug` / `info` / `warn` / `error`）。
 */
export function emitSDKLog(args: {
  logger?: SDKLogger;
  logLevel?: SDKLogLevel;
  level: Exclude<SDKLogLevel, 'silent'>;
  event: Omit<LogEvent, 'source'>;
}): void {
  if (!shouldEmitLog(args.logLevel, args.logger != null, args.level)) {
    return;
  }

  const logger = args.logger ?? createConsoleSDKLogger();
  const payload: LogEvent = {
    source: 'agent-sdk',
    ...args.event
  };

  logger[args.level]?.(payload);
}

export function extractProviderRequestId(headers: Headers | undefined): string | undefined {
  if (headers == null) {
    return undefined;
  }
  return headers.get('x-request-id')
    ?? headers.get('request-id')
    ?? headers.get('x-amzn-requestid')
    ?? undefined;
}
