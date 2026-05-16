import { afterEach, describe, expect, it, vi } from 'vitest';
import { coerceLogEventEpochMs, formatStructuredLogWallClock } from '../../src/core/log-timestamp.js';

describe('formatStructuredLogWallClock', () => {
  const fixed = Date.UTC(2026, 4, 16, 12, 34, 56, 789);

  afterEach(() => {
    delete process.env.AGENT_SDK_LOG_TZ;
    vi.restoreAllMocks();
  });

  it('formats UTC wall clock when AGENT_SDK_LOG_TZ is UTC', () => {
    process.env.AGENT_SDK_LOG_TZ = 'UTC';
    expect(formatStructuredLogWallClock(fixed)).toBe('2026-05-16 12:34:56.789 Z');
  });

  it('formats fixed instant in Asia/Shanghai (always +08:00 standard time)', () => {
    process.env.AGENT_SDK_LOG_TZ = 'Asia/Shanghai';
    expect(formatStructuredLogWallClock(fixed)).toBe('2026-05-16 20:34:56.789 +08:00');
  });

  it('coerces millis and parses ISO-ish strings', () => {
    expect(coerceLogEventEpochMs(1_717_056_496_789)).toBe(1_717_056_496_789);
    expect(coerceLogEventEpochMs('2026-05-16T12:34:56.789Z')).toBe(Date.parse('2026-05-16T12:34:56.789Z'));
  });
});
