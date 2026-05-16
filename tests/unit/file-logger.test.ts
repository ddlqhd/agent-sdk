import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createFileJSONLLogger } from '../../src/core/file-logger.js';
import type { LogEvent } from '../../src/core/types.js';

function makeEvent(over: Partial<LogEvent> = {}): LogEvent {
  return {
    source: 'agent-sdk',
    component: 'agent',
    event: 'agent.run.start',
    message: 'starting',
    ...over
  };
}

describe('createFileJSONLLogger', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-sdk-file-logger-'));
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('writes one valid JSON object per line and creates parent dirs', async () => {
    const filePath = join(dir, 'nested', 'deep', 'agent-sdk.log');
    const logger = createFileJSONLLogger({ filePath });

    logger.info?.(makeEvent({ event: 'agent.run.start' }));
    logger.warn?.(makeEvent({ event: 'agent.run.warn', message: 'warn one' }));
    logger.error?.(makeEvent({ event: 'agent.run.error', message: 'boom' }));

    await logger.close();

    expect(existsSync(filePath)).toBe(true);
    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);

    const parsed = lines.map(line => JSON.parse(line) as LogEvent);
    expect(parsed[0].timestamp).toBeDefined();
    expect(typeof parsed[0].timestamp).toBe('string');
    expect(parsed[0].timestamp as string).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/);
    expect(parsed[0].event).toBe('agent.run.start');

    expect(parsed[0].source).toBe('agent-sdk');
    expect(parsed[1].message).toBe('warn one');
    expect(parsed[2].event).toBe('agent.run.error');
  });

  it('exposes filePath and is idempotent on close', async () => {
    const filePath = join(dir, 'idempotent.log');
    const logger = createFileJSONLLogger({ filePath });

    expect(logger.filePath).toBe(filePath);
    logger.debug?.(makeEvent({ event: 'agent.debug' }));

    await logger.close();
    await logger.close();

    const raw = readFileSync(filePath, 'utf-8');
    expect(raw.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('silently ignores writes after close', async () => {
    const filePath = join(dir, 'after-close.log');
    const logger = createFileJSONLLogger({ filePath });

    logger.info?.(makeEvent({ event: 'before.close' }));
    await logger.close();

    expect(() => {
      logger.info?.(makeEvent({ event: 'after.close' }));
    }).not.toThrow();

    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0]) as LogEvent).event).toBe('before.close');
  });

  it('supports a custom serialize function', async () => {
    const filePath = join(dir, 'custom-serialize.log');
    const logger = createFileJSONLLogger({
      filePath,
      serialize: (event) => JSON.stringify({ tag: 'custom', e: event.event })
    });

    logger.info?.(makeEvent({ event: 'agent.iteration.start' }));
    await logger.close();

    const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    expect(JSON.parse(lines[0])).toEqual({ tag: 'custom', e: 'agent.iteration.start' });
  });
});
