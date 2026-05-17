import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bashTool } from '../../src/tools/builtin/shell.js';
import type { ToolExecutionContext } from '../../src/core/types.js';

const KEY = 'AGENT_SDK_BASH_ENV_TEST';

describe('Bash tool + Agent env (mergeProcessEnv via context.env)', () => {
  beforeEach(() => {
    delete process.env[KEY];
  });

  afterEach(() => {
    delete process.env[KEY];
  });

  it('foreground: context.env overrides process.env for spawned child', async () => {
    process.env[KEY] = 'base_value';
    const command = `node -e "console.log(process.env.${KEY} || '')"`;
    const result = await bashTool.handler(
      { command },
      { env: { [KEY]: 'agent_value' } } as ToolExecutionContext
    );
    expect(result.isError).not.toBe(true);
    expect(result.content).toContain('agent_value');
    expect(result.content).not.toContain('base_value');
  });

  it('foreground: context.env supplies value when key absent from process.env', async () => {
    const command = `node -e "console.log(process.env.${KEY} || '')"`;
    const result = await bashTool.handler(
      { command },
      { env: { [KEY]: 'only_agent' } } as ToolExecutionContext
    );
    expect(result.isError).not.toBe(true);
    expect(result.content).toContain('only_agent');
  });

  it('background: spawned child sees merged context.env', async () => {
    process.env[KEY] = 'base_value';
    const command = `node -e "console.log(process.env.${KEY} || '')"`;
    const result = await bashTool.handler(
      {
        command,
        background: true,
        blockUntilMs: 10_000
      },
      { env: { [KEY]: 'agent_value' } } as ToolExecutionContext
    );
    expect(result.content).toContain('agent_value');
    expect(result.content).not.toContain('base_value');
  });
});
