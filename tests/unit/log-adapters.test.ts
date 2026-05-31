import { describe, expect, it, vi } from 'vitest';
import { adaptMessageLogger } from '../../src/core/log-adapters.js';
import type { LogEvent } from '../../src/core/types.js';

describe('log adapters', () => {
  it('adaptMessageLogger respects optional level methods', () => {
    const info = vi.fn();
    const adapter = adaptMessageLogger({
      debug: vi.fn(),
      info,
      warn: vi.fn(),
      error: vi.fn()
    });

    const event: LogEvent = {
      source: 'agent-sdk',
      component: 'tooling',
      event: 'tool.call.end'
    };

    adapter.warn?.(event);
    expect(info).not.toHaveBeenCalled();
    expect(adapter.warn).toBeDefined();
  });

  it('adaptMessageLogger forwards formatted line and event object', () => {
    const debug = vi.fn();
    const info = vi.fn();
    const adapter = adaptMessageLogger({ debug, info, warn: vi.fn(), error: vi.fn() });

    const event: LogEvent = {
      source: 'agent-sdk',
      component: 'agent',
      event: 'agent.run.start',
      message: 'run'
    };

    adapter.info?.(event);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toContain('[agent-sdk][agent][agent.run.start]');
    expect(info.mock.calls[0]?.[1]).toBe(event);
  });
});
