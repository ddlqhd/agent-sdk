import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCliProgram } from '../../packages/agent-sdk-cli/src/program.js';

/**
 * 根命令与子命令共享的 flag（`--user-base-path` / `--model` / `--cwd` …）历史上会被根命令
 * 在整条 argv 上先吃掉，子命令拿到的永远是默认值。这里回归覆盖两种 flag 位置。
 */

const SEED_ID = 'cli-program-options-seed';

function seedSession(basePath: string): string {
  const dir = join(basePath, '.claude', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${SEED_ID}.meta.json`),
    JSON.stringify({
      id: SEED_ID,
      createdAt: 1,
      updatedAt: 2,
      messageCount: 3,
      cwd: basePath
    })
  );
  return dir;
}

async function runCli(args: string[]): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
    lines.push(values.map((v) => String(v)).join(' '));
  });
  try {
    const program = createCliProgram();
    await program.parseAsync(args, { from: 'user' });
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

describe('CLI root/subcommand option wiring', () => {
  it('forwards --user-base-path written after the subcommand', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cli-ubp-after-'));
    seedSession(base);

    const out = await runCli(['sessions', 'list', '-f', 'json', '--user-base-path', base]);

    expect(out).toContain(SEED_ID);
  });

  it('forwards --user-base-path written before the subcommand', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cli-ubp-before-'));
    seedSession(base);

    const out = await runCli(['--user-base-path', base, 'sessions', 'list', '-f', 'json']);

    expect(out).toContain(SEED_ID);
  });

  it('does not fall back to the home session dir when the flag is honored', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cli-ubp-empty-'));

    const out = await runCli(['sessions', 'list', '-f', 'json', '--user-base-path', base]);

    expect(out.trim()).toBe('[]');
  });
});
