import type { LogEvent } from './types.js';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/**
 * Parse {@link LogEvent.timestamp} (ms 或 ISO 串) 为 Unix 毫秒；非法或缺省为 `Date.now()`。
 */
export function coerceLogEventEpochMs(timestamp: LogEvent['timestamp'] | undefined): number {
  if (timestamp === undefined || timestamp === null) {
    return Date.now();
  }
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return timestamp;
  }
  if (typeof timestamp === 'string' && timestamp.trim() !== '') {
    const parsed = Date.parse(timestamp);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

/** `±HH:mm`，与 `getTimezoneOffset()` 符号约定一致（负值表示东于 UTC 的时区） */
function offsetFromGetTimezoneOffset(date: Date): string {
  const totalMin = -date.getTimezoneOffset();
  const sign = totalMin >= 0 ? '+' : '-';
  const abs = Math.abs(totalMin);
  const h = pad2(Math.floor(abs / 60));
  const m = pad2(abs % 60);
  return `${sign}${h}:${m}`;
}

function formatLocalWallClock(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const mo = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  const ms = pad3(d.getMilliseconds());
  return `${y}-${mo}-${day} ${hh}:${mi}:${ss}.${ms} ${offsetFromGetTimezoneOffset(d)}`;
}

function formatUtc(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear();
  const mo = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const mi = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  const ms = pad3(d.getUTCMilliseconds());
  return `${y}-${mo}-${day} ${hh}:${mi}:${ss}.${ms} Z`;
}

/**
 * Normalize `GMT+8`, `GMT+08:30` 等为 `±HH:mm`（用于展示）。
 */
function normalizeIntlGmtLongOffset(part: string | undefined): string {
  const raw = part?.trim() ?? '';
  const m = raw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (!m) {
    return raw === '' || raw.toUpperCase() === 'GMT' ? '+00:00' : raw;
  }
  const sign = m[1] === '-' ? '-' : '+';
  const h = pad2(Number.parseInt(m[2] ?? '0', 10));
  const min = pad2(Number.parseInt(m[3] ?? '0', 10));
  return `${sign}${h}:${min}`;
}

function formatInIanaZone(epochMs: number, ianaTz: string): string {
  const instant = new Date(epochMs);

  try {
    const calRaw = new Intl.DateTimeFormat('sv-SE', {
      timeZone: ianaTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      fractionalSecondDigits: 3
    }).format(instant);

    const cal = calRaw.replace(',', '.');

    const offParts = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaTz,
      timeZoneName: 'longOffset'
    }).formatToParts(instant);
    const rawOff = offParts.find((p) => p.type === 'timeZoneName')?.value;

    const off = normalizeIntlGmtLongOffset(rawOff);
    return `${cal.replace('T', ' ')} ${off}`;
  } catch {
    return formatLocalWallClock(epochMs);
  }
}

function resolveTzFromEnv(): string | undefined {
  if (typeof process === 'undefined' || process.env.AGENT_SDK_LOG_TZ == null) {
    return undefined;
  }
  const t = process.env.AGENT_SDK_LOG_TZ.trim();
  return t === '' ? undefined : t;
}

/**
 * 将 Unix 毫秒格式化为 `YYYY-MM-DD HH:mm:ss.sss ±HH:mm` / `… Z`。
 *
 * - 未设置或空 `AGENT_SDK_LOG_TZ`：进程**本地时区**（与 `TZ` 环境变量对 Node 的约定一致），偏移量随 `Intl`/`Date`。
 * - `UTC`、`Etc/UTC`：UTC，后缀 `Z`。
 * - 其他值：IANA Olson 名（如 `Asia/Shanghai`），时间为该区内墙钟时刻 + 该瞬时的 UTC 偏移展示。
 *
 * @param epochMs - Unix milliseconds
 */
export function formatStructuredLogWallClock(epochMs: number): string {
  const raw = resolveTzFromEnv();
  if (raw == null) {
    return formatLocalWallClock(epochMs);
  }
  const up = raw.toUpperCase();
  if (up === 'UTC' || up === 'ETC/UTC' || raw === 'Z') {
    return formatUtc(epochMs);
  }
  if (raw.toLowerCase() === 'local') {
    return formatLocalWallClock(epochMs);
  }

  return formatInIanaZone(epochMs, raw);
}
