import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createWebCommand } from '../../packages/agent-sdk-cli/src/commands/web.js';
import { resolveCliPackageRoot } from '../../packages/agent-sdk-cli/src/web/paths.js';
import {
  assertLoopbackBind,
  isAllowedWsOrigin,
  isLoopbackListenHost,
  parseClientMessage,
  parseListenPort,
  resolveListenPort,
  resolveStaticFile
} from '../../packages/agent-sdk-cli/src/web/http-utils.js';

function makeClientDist(): string {
  const root = mkdtempSync(join(tmpdir(), 'cli-web-static-'));
  writeFileSync(join(root, 'index.html'), '<html></html>');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  return root;
}

describe('createWebCommand', () => {
  it('registers web with port, host, demo-tools, and allow-remote', () => {
    const cmd = createWebCommand();
    expect(cmd.name()).toBe('web');
    const longs = cmd.options.map((o) => o.long);
    expect(longs).toContain('--port');
    expect(longs).toContain('--host');
    expect(longs).toContain('--demo-tools');
    expect(longs).toContain('--allow-remote');
    expect(longs).toContain('--provider');
    expect(longs).toContain('--cwd');
    expect(longs).toContain('--exec-server');
    expect(longs).toContain('--exec-token');
    expect(longs).toContain('--user-base-path');
    expect(longs).not.toContain('--session');
    expect(longs).not.toContain('--resume');
    expect(longs).not.toContain('--temperature');
  });
});

describe('resolveCliPackageRoot', () => {
  it('finds @ddlqhd/agent-sdk-cli from src/web/paths.ts', () => {
    const root = resolveCliPackageRoot();
    expect(root.endsWith('packages/agent-sdk-cli')).toBe(true);
  });
});

describe('resolveListenPort', () => {
  it('prefers the flag, then PORT, then 3001', () => {
    expect(resolveListenPort(8123, '9')).toBe(8123);
    expect(resolveListenPort(undefined, '4455')).toBe(4455);
    expect(resolveListenPort(undefined, undefined)).toBe(3001);
    expect(resolveListenPort(undefined, '')).toBe(3001);
  });

  it('rejects invalid PORT values', () => {
    expect(() => parseListenPort('abc')).toThrow(/Invalid --port/);
    expect(() => resolveListenPort(undefined, '0')).toThrow(/Invalid --port/);
    expect(() => resolveListenPort(undefined, '70000')).toThrow(/Invalid --port/);
  });
});

describe('isAllowedWsOrigin', () => {
  it('allows loopback origins on the listen port', () => {
    expect(isAllowedWsOrigin('http://127.0.0.1:3001', '127.0.0.1', 3001, false)).toBe(true);
    expect(isAllowedWsOrigin('http://localhost:3001', '127.0.0.1', 3001, false)).toBe(true);
    expect(isAllowedWsOrigin(undefined, '127.0.0.1', 3001, false)).toBe(true);
  });

  it('rejects other sites and port mismatches', () => {
    expect(isAllowedWsOrigin('http://evil.example:3001', '127.0.0.1', 3001, false)).toBe(false);
    expect(isAllowedWsOrigin('http://127.0.0.1:4000', '127.0.0.1', 3001, false)).toBe(false);
    expect(isAllowedWsOrigin('http://192.168.1.5:3001', '127.0.0.1', 3001, false)).toBe(false);
  });

  it('skips checks when allowRemote is set', () => {
    expect(isAllowedWsOrigin('http://evil.example', '0.0.0.0', 3001, true)).toBe(true);
  });

  it('treats missing Origin as loopback-only', () => {
    expect(isAllowedWsOrigin(undefined, '0.0.0.0', 3001, false)).toBe(false);
    expect(isLoopbackListenHost('0.0.0.0')).toBe(false);
    expect(isLoopbackListenHost('127.0.0.1')).toBe(true);
  });
});

describe('resolveStaticFile', () => {
  const dist = makeClientDist();
  const sibling = join(dist, '..', `${dist.split('/').pop()}-backup`);
  mkdirSync(sibling, { recursive: true });
  writeFileSync(join(sibling, 'secret.txt'), 'nope');

  it('serves files under the client dist', () => {
    expect(resolveStaticFile(dist, '/')).toBe(join(dist, 'index.html'));
    expect(resolveStaticFile(dist, '/assets/app.js')).toBe(join(dist, 'assets', 'app.js'));
  });

  it('rejects directories, traversal, and bad encoding', () => {
    expect(resolveStaticFile(dist, '/assets')).toBeNull();
    expect(resolveStaticFile(dist, '/../secret.txt')).toBeNull();
    expect(resolveStaticFile(dist, `../${basename(sibling)}/secret.txt`)).toBeNull();
    expect(resolveStaticFile(dist, '/%2e%2e/secret.txt')).toBeNull();
    expect(resolveStaticFile(dist, '/%')).toBeNull();
  });
});

describe('parseClientMessage', () => {
  it('accepts a well-formed configure and chat', () => {
    const cfg = parseClientMessage({
      type: 'configure',
      provider: 'openai',
      model: 'gpt-4o',
      storage: 'jsonl'
    });
    expect(cfg.ok).toBe(true);
    const chat = parseClientMessage({ type: 'chat', text: 'hi', requestId: 'r1' });
    expect(chat.ok).toBe(true);
  });

  it('rejects unknown types and missing required fields', () => {
    expect(parseClientMessage({ type: 'sessions:resume' }).ok).toBe(false);
    expect(parseClientMessage({ type: 'chat', text: 'hi' }).ok).toBe(false);
    expect(parseClientMessage({ type: 'nope' }).ok).toBe(false);
    expect(parseClientMessage(null).ok).toBe(false);
  });
});

describe('assertLoopbackBind', () => {
  it('refuses a non-loopback host without --allow-remote', () => {
    expect(() => assertLoopbackBind('0.0.0.0', 3001, false)).toThrow(/allow-remote/);
    expect(() => assertLoopbackBind('0.0.0.0', 3001, true)).not.toThrow();
    expect(() => assertLoopbackBind('127.0.0.1', 3001, false)).not.toThrow();
  });
});
