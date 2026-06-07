import { describe, it, expect } from 'vitest';
import { stripAnsi, withCapturedConsoleLog } from '../../src/cli/tui/capture-console.js';

describe('stripAnsi', () => {
  it('removes color codes', () => {
    expect(stripAnsi('\x1b[32mok\x1b[0m')).toBe('ok');
  });
});

describe('withCapturedConsoleLog', () => {
  it('captures logs and restores console.log', async () => {
    const marker = 'restore-check';
    const { result, logs } = await withCapturedConsoleLog(async () => {
      console.log('hello', 'world');
      return 42;
    });
    expect(result).toBe(42);
    expect(logs).toEqual(['hello world']);
    console.log(marker);
    expect(logs).toHaveLength(1);
  });
});
