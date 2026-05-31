import { afterEach, describe, expect, it } from 'vitest';
import {
  createSDKLogContext,
  sdkLog,
  withLogScope
} from '../../src/core/log-context.js';
import type { LogEvent } from '../../src/core/types.js';

function createCaptureLogger(events: LogEvent[]) {
  return {
    debug(event: LogEvent) {
      events.push(event);
    },
    info(event: LogEvent) {
      events.push(event);
    },
    warn(event: LogEvent) {
      events.push(event);
    },
    error(event: LogEvent) {
      events.push(event);
    }
  };
}

describe('SDKLogContext', () => {
  afterEach(() => {
    delete process.env.AGENT_SDK_LOG_LEVEL;
  });

  it('merges scope fields into emitted events', () => {
    const logs: LogEvent[] = [];
    const ctx = createSDKLogContext(
      { logger: createCaptureLogger(logs), logLevel: 'info' },
      { sessionId: 'sess-1', runId: 'run-1', agentName: 'TestAgent', cwd: '/tmp' }
    );

    sdkLog(ctx, 'info', {
      component: 'agent',
      event: 'agent.run.start',
      message: 'run'
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.sessionId).toBe('sess-1');
    expect(logs[0]?.runId).toBe('run-1');
    expect(logs[0]?.agentName).toBe('TestAgent');
    expect(logs[0]?.cwd).toBe('/tmp');
  });

  it('falls back to context when event scope fields are empty strings', () => {
    const logs: LogEvent[] = [];
    const ctx = createSDKLogContext(
      { logger: createCaptureLogger(logs), logLevel: 'info' },
      { sessionId: 'sess-ctx', runId: 'run-ctx' }
    );

    sdkLog(ctx, 'info', {
      component: 'agent',
      event: 'agent.run.start',
      sessionId: '',
      runId: ''
    });

    expect(logs[0]?.sessionId).toBe('sess-ctx');
    expect(logs[0]?.runId).toBe('run-ctx');
  });

  it('allows event fields to override context scope', () => {
    const logs: LogEvent[] = [];
    const ctx = createSDKLogContext(
      { logger: createCaptureLogger(logs), logLevel: 'info' },
      { runId: 'run-ctx' }
    );

    sdkLog(ctx, 'info', {
      component: 'agent',
      event: 'agent.run.end',
      runId: 'run-event'
    });

    expect(logs[0]?.runId).toBe('run-event');
  });

  it('withLogScope updates correlation fields', () => {
    const base = createSDKLogContext({ logLevel: 'info' }, { runId: 'old' });
    const next = withLogScope(base, { runId: 'new', sessionId: 's2' });
    expect(next.runId).toBe('new');
    expect(next.sessionId).toBe('s2');
    expect(base.runId).toBe('old');
  });

  it('does not emit when logLevel is silent and no logger', () => {
    const logs: LogEvent[] = [];
    const ctx = createSDKLogContext({ logLevel: 'silent' });

    sdkLog(ctx, 'info', {
      component: 'agent',
      event: 'agent.run.start'
    });

    expect(logs).toHaveLength(0);
  });

  it('no-ops when ctx is undefined', () => {
    const logs: LogEvent[] = [];
    sdkLog(undefined, 'info', {
      component: 'agent',
      event: 'agent.run.start'
    });
    expect(logs).toHaveLength(0);
  });
});
