import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  createEnvironmentFromConfig,
  createLocalEnvironment,
  decodeBytes,
  encodeBytes,
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
  startExecServer,
  connectRemoteEnvironment,
  formatExecServerLogLine,
  summarizeRpcParams,
  type ExecServerLogEvent,
  type RunningExecServer
} from '@ddlqhd/agent-sdk-exec';
import { readFileTool, writeFileTool, globTool } from '../../packages/agent-sdk/src/tools/builtin/filesystem.js';
import { grepTool } from '../../packages/agent-sdk/src/tools/builtin/grep.js';
import { bashTool } from '../../packages/agent-sdk/src/tools/builtin/shell.js';

describe('exec protocol helpers', () => {
  it('round-trips JSON-RPC and bytes', () => {
    const msg = { jsonrpc: '2.0' as const, id: 1, method: 'initialize', params: { clientName: 't' } };
    const parsed = parseJsonRpcMessage(serializeJsonRpcMessage(msg));
    expect(parsed).toEqual(msg);
    const buf = new Uint8Array([1, 2, 3, 250]);
    expect(Array.from(decodeBytes(encodeBytes(buf)))).toEqual([1, 2, 3, 250]);
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('LocalEnvironment', () => {
  it('reads, writes, globs, and searches inside a workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'exec-local-'));
    writeFileSync(join(root, 'hello.txt'), 'hello world\nsecond line\n');
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), 'export const x = 1;\n');

    const env = createLocalEnvironment({ workspaceRoot: root });
    const text = await env.fs.readText(join(root, 'hello.txt'), { lineOffset: 1, lineLimit: 10 });
    expect(text.lines[0]).toContain('hello world');

    await env.fs.writeText(join(root, 'out.txt'), 'written', { encoding: 'utf8' });
    const written = await env.fs.readText(join(root, 'out.txt'));
    expect(written.text).toBe('written');

    const matches = await env.fs.glob('**/*.ts', { cwd: root });
    expect(matches.some((m) => m.path.endsWith('a.ts'))).toBe(true);

    const search = await env.fs.search({
      pattern: 'export const',
      path: root,
      projectDir: root
    });
    expect(search.ok).toBe(true);
    expect(search.content).toMatch(/export const/);
  });

  it('rejects paths outside the workspace root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'exec-jail-'));
    const env = createLocalEnvironment({ workspaceRoot: root });
    await expect(env.fs.stat('/etc/passwd')).rejects.toThrow(/outside workspace root/);
  });
});

describe('builtin tools via Environment', () => {
  it('Write/Read/Glob/Grep/Bash use the injected environment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'exec-tools-'));
    const env = createLocalEnvironment({ workspaceRoot: root });
    const ctx = { projectDir: root, environment: env };

    const w = await writeFileTool.handler({ file_path: join(root, 'n.txt'), content: 'alpha beta' }, ctx);
    expect(w.isError).toBeFalsy();

    const r = await readFileTool.handler({ file_path: join(root, 'n.txt') }, ctx);
    expect(r.content).toContain('alpha beta');

    const g = await globTool.handler({ pattern: '*.txt' }, ctx);
    expect(g.content).toContain('n.txt');

    const s = await grepTool.handler(
      { pattern: 'alpha', path: root, case_insensitive: false, context: 0, head_limit: 20 },
      ctx
    );
    expect(s.content).toMatch(/alpha/);

    const b = await bashTool.handler({ command: 'printf hi' }, ctx);
    expect(b.isError).toBeFalsy();
    expect(b.content).toContain('hi');
  });
});

describe('createEnvironmentFromConfig', () => {
  it('returns a local environment by default', async () => {
    const env = await createEnvironmentFromConfig('local', { env: {} });
    expect(env.id.startsWith('local-')).toBe(true);
  });
});

describe('exec-server request logs', () => {
  it('summarizes RPC params without tokens or file bodies', () => {
    expect(
      summarizeRpcParams('initialize', {
        clientName: 'agent-sdk',
        protocolVersion: '1.0.0',
        token: 'secret'
      })
    ).toEqual({ clientName: 'agent-sdk', protocolVersion: '1.0.0' });
    expect(summarizeRpcParams('fs/writeText', { path: '/repo/a.ts', text: 'hello' })).toEqual({
      path: '/repo/a.ts',
      textChars: 5
    });
    expect(summarizeRpcParams('process/start', { command: 'printf hi', cwd: '/repo' })).toEqual({
      command: 'printf hi',
      cwd: '/repo'
    });
  });

  it('formats a single-line request log', () => {
    const line = formatExecServerLogLine({
      timestamp: '2026-09-19T00:00:00.000Z',
      event: 'request',
      sessionId: 'sess-1',
      method: 'fs/readText',
      ok: true,
      durationMs: 4,
      detail: { path: '/repo/a.ts' }
    });
    expect(line).toBe(
      '2026-09-19T00:00:00.000Z [exec-server] session=sess-1 event=request method=fs/readText ok 4ms path=/repo/a.ts'
    );
  });
});

describe('remote exec-server loopback', () => {
  let server: RunningExecServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('connects over WebSocket and performs fs + process RPCs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'exec-ws-'));
    writeFileSync(join(root, 'remote.txt'), 'from-exec\n');
    const logs: ExecServerLogEvent[] = [];
    server = await startExecServer({
      host: '127.0.0.1',
      port: 0,
      cwd: root,
      token: 'secret',
      log: (entry) => logs.push(entry)
    });

    const remote = await connectRemoteEnvironment({
      type: 'remote',
      url: server.url,
      token: 'secret',
      clientName: 'vitest'
    });

    const text = await remote.fs.readText(join(root, 'remote.txt'));
    expect(text.lines.join('\n')).toContain('from-exec');

    const handle = await remote.process.start({ command: 'printf remote-hi' });
    const wait = await handle.wait({ timeoutMs: 10_000 });
    expect(wait.aborted).toBe(false);
    expect(wait.timedOut).toBe(false);
    expect(wait.stdout).toContain('remote-hi');

    await remote.close();

    const methods = logs.filter((e) => e.event === 'request' || e.event === 'notification').map((e) => e.method);
    expect(methods).toContain('initialize');
    expect(methods).toContain('initialized');
    expect(methods).toContain('fs/readText');
    expect(methods).toContain('process/start');
    expect(logs.some((e) => e.event === 'connection')).toBe(true);
    expect(JSON.stringify(logs)).not.toContain('secret');
  });
});
