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
import { assertAgentEnvironmentReady } from '@ddlqhd/agent-sdk';
import { createCliAgent } from '../../packages/agent-sdk-cli/src/utils/agent-bootstrap.js';
import { handleRequest, type ExecSession } from '../../packages/agent-sdk-exec/src/server/handler.js';
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

  it('allows the user skills root and rejects other HOME paths', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'exec-ws-jail-'));
    const userHome = mkdtempSync(join(tmpdir(), 'exec-home-jail-'));
    const skillDir = join(userHome, '.claude', 'skills', 'demo');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: From home\n---\n\nBody\n');
    writeFileSync(join(userHome, 'secret.txt'), 'nope');

    const env = createLocalEnvironment({ workspaceRoot: workspace, userHome });
    const text = await env.fs.readText(join(skillDir, 'SKILL.md'));
    expect(text.text ?? text.lines.join('\n')).toContain('From home');
    await expect(env.fs.stat(join(userHome, 'secret.txt'))).rejects.toThrow(/outside workspace root/);
    await expect(env.fs.writeText(join(skillDir, 'evil.md'), 'nope')).rejects.toThrow(/outside workspace root/);
    await expect(env.process.start({ command: 'true', cwd: skillDir })).rejects.toThrow(/outside workspace root/);
  });

  it('lists user and workspace skills without bodies', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'exec-skill-ws-'));
    const userHome = mkdtempSync(join(tmpdir(), 'exec-skill-home-'));
    const userSkill = join(userHome, '.claude', 'skills', 'home-skill');
    const wsSkill = join(workspace, '.claude', 'skills', 'ws-skill');
    mkdirSync(userSkill, { recursive: true });
    mkdirSync(wsSkill, { recursive: true });
    writeFileSync(
      join(userSkill, 'SKILL.md'),
      '---\nname: home-skill\ndescription: User catalog\nargumentHint: "[x]"\n---\n\nSECRET_BODY\n'
    );
    writeFileSync(
      join(wsSkill, 'SKILL.md'),
      '---\nname: ws-skill\ndescription: Workspace catalog\ndisableModelInvocation: true\n---\n\nWS_BODY\n'
    );

    const env = createLocalEnvironment({ workspaceRoot: workspace, userHome });
    const skills = await env.listSkills();
    expect(skills.map((s) => s.name).sort()).toEqual(['home-skill', 'ws-skill']);
    const home = skills.find((s) => s.name === 'home-skill')!;
    expect(home.description).toBe('User catalog');
    expect(home.scope).toBe('user');
    expect(home.argumentHint).toBe('[x]');
    expect(home.path).toBe(join(userSkill, 'SKILL.md'));
    expect(JSON.stringify(skills)).not.toContain('SECRET_BODY');
    expect(JSON.stringify(skills)).not.toContain('WS_BODY');
  });

  it('lists skills from SkillConfig.workspacePath instead of cwd/.claude/skills', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'exec-skill-custom-'));
    const userHome = mkdtempSync(join(tmpdir(), 'exec-skill-custom-home-'));
    const custom = join(workspace, 'custom-skills', 'custom-demo');
    mkdirSync(custom, { recursive: true });
    writeFileSync(
      join(custom, 'SKILL.md'),
      '---\nname: custom-demo\ndescription: |\n  Line one\n  Line two\n---\n\nBody\n'
    );

    const env = createLocalEnvironment({ workspaceRoot: workspace, userHome });
    const skills = await env.listSkills({ workspaceSkillsPath: join(workspace, 'custom-skills') });
    expect(skills.map((s) => s.name)).toEqual(['custom-demo']);
    expect(skills[0]!.description).toContain('Line one');
    expect(skills[0]!.description).toContain('Line two');
  });

  it('echoes process/write through piped stdin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'exec-stdin-'));
    const env = createLocalEnvironment({ workspaceRoot: root });
    const handle = await env.process.start({
      command: process.execPath,
      args: ['-e', 'process.stdin.on("data", (d) => { process.stdout.write(d); process.exit(0); })'],
      background: true,
      pipeStdin: true
    });
    await handle.write(new TextEncoder().encode('hello-stdin\n'));
    const out = await handle.read({ stream: 'stdout', raw: true, waitMs: 3000 });
    expect(out.content).toContain('hello-stdin');
    await handle.terminate({ killDelayMs: 200 }).catch(() => undefined);
  });

  it('advances stdout cursor by returned chars when the 32k default limit applies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'exec-limit-'));
    const env = createLocalEnvironment({ workspaceRoot: root });
    const handle = await env.process.start({
      command: process.execPath,
      args: ['-e', "process.stdout.write('x'.repeat(40000) + 'DONE\\n')"],
      background: true
    });
    await handle.wait({ timeoutMs: 5000 });
    const first = await handle.read({ stream: 'stdout', raw: true, sinceCursor: 0 });
    expect(first.content.length).toBe(32_000);
    expect(first.nextCursorStdout).toBe(32_000);
    const second = await handle.read({
      stream: 'stdout',
      raw: true,
      sinceCursor: first.nextCursorStdout,
      waitMs: 1000
    });
    expect(second.content).toContain('DONE');
    await handle.terminate({ killDelayMs: 200 }).catch(() => undefined);
  });

  it('does not inherit process.env when replaceEnv is true', async () => {
    const root = mkdtempSync(join(tmpdir(), 'exec-env-'));
    const env = createLocalEnvironment({ workspaceRoot: root });
    const marker = 'agent-sdk-exec-env-leak';
    process.env.AGENT_SDK_TEST_SECRET = marker;
    try {
      const leaked = await env.process.start({
        command: process.execPath,
        args: ['-e', "process.stdout.write(process.env.AGENT_SDK_TEST_SECRET || '')"],
        background: true
      });
      const leakedOut = await leaked.wait({ timeoutMs: 5000 });
      expect(leakedOut.stdout).toContain(marker);
      await leaked.terminate({ killDelayMs: 200 }).catch(() => undefined);

      const isolated = await env.process.start({
        command: process.execPath,
        args: ['-e', "process.stdout.write(process.env.AGENT_SDK_TEST_SECRET || '')"],
        replaceEnv: true,
        env: { PATH: process.env.PATH ?? '' },
        background: true
      });
      const isolatedOut = await isolated.wait({ timeoutMs: 5000 });
      expect(isolatedOut.stdout).not.toContain(marker);
      await isolated.terminate({ killDelayMs: 200 }).catch(() => undefined);
    } finally {
      delete process.env.AGENT_SDK_TEST_SECRET;
    }
  });

  it('returns stderr for foreground raw reads', async () => {
    const root = mkdtempSync(join(tmpdir(), 'exec-fg-stderr-'));
    const env = createLocalEnvironment({ workspaceRoot: root });
    const handle = await env.process.start({
      command: process.execPath,
      args: ['-e', "process.stderr.write('err-only'); process.stdout.write('out-only')"]
    });
    await handle.wait({ timeoutMs: 5000 });
    const err = await handle.read({ stream: 'stderr', raw: true });
    expect(err.content).toContain('err-only');
    expect(err.content).not.toContain('out-only');
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

    expect(remote.info.userHome).toBeTruthy();

    const text = await remote.fs.readText(join(root, 'remote.txt'));
    expect(text.lines.join('\n')).toContain('from-exec');

    const skills = await remote.listSkills();
    expect(Array.isArray(skills)).toBe(true);

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
    const sessionIds = new Set(logs.map((e) => e.sessionId));
    expect(sessionIds.size).toBe(1);
  });

  it('rejects fs RPCs until initialize then initialized, and keeps session.id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'exec-hs-'));
    writeFileSync(join(root, 'remote.txt'), 'from-exec\n');
    const environment = createLocalEnvironment({ workspaceRoot: root });
    const session: ExecSession = {
      id: 'sess-fixed',
      initializeAccepted: false,
      initialized: false,
      environment,
      processes: new Map()
    };
    const ctx = { token: 'secret', environment, session };

    await expect(
      handleRequest(ctx, { jsonrpc: '2.0', id: 1, method: 'initialized' }, 'secret')
    ).rejects.toThrow(/not initialized/i);
    await expect(
      handleRequest(
        ctx,
        { jsonrpc: '2.0', id: 2, method: 'fs/getMetadata', params: { path: join(root, 'remote.txt') } },
        'secret'
      )
    ).rejects.toThrow(/not initialized/i);

    const init = (await handleRequest(
      ctx,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'initialize',
        params: { clientName: 'vitest', protocolVersion: PROTOCOL_VERSION, token: 'secret' }
      },
      'secret'
    )) as { sessionId: string };
    expect(init.sessionId).toBe('sess-fixed');
    expect(session.id).toBe('sess-fixed');

    await expect(
      handleRequest(
        ctx,
        { jsonrpc: '2.0', id: 4, method: 'fs/getMetadata', params: { path: join(root, 'remote.txt') } },
        'secret'
      )
    ).rejects.toThrow(/not initialized/i);

    await handleRequest(ctx, { jsonrpc: '2.0', id: 5, method: 'initialized' }, 'secret');
    const meta = (await handleRequest(
      ctx,
      { jsonrpc: '2.0', id: 6, method: 'fs/getMetadata', params: { path: join(root, 'remote.txt') } },
      'secret'
    )) as { isFile: boolean };
    expect(meta.isFile).toBe(true);
  });
});

describe('assertAgentEnvironmentReady', () => {
  it('passes when environment init succeeded', () => {
    expect(() => assertAgentEnvironmentReady({ environment: { ok: true } })).not.toThrow();
  });

  it('throws the init error when environment failed', () => {
    expect(() =>
      assertAgentEnvironmentReady({
        environment: { ok: false, error: { name: 'Error', message: 'getaddrinfo ENOTFOUND workspace' } }
      })
    ).toThrow(/getaddrinfo ENOTFOUND workspace/);
  });
});

describe('createCliAgent environment init', () => {
  it('does not start when exec-server is unreachable', async () => {
    await expect(
      createCliAgent({
        provider: 'openai',
        apiKey: 'test',
        model: 'gpt-4o',
        bare: true,
        execServer: 'ws://127.0.0.1:1',
        logLevel: 'silent'
      })
    ).rejects.toThrow(/Failed to initialize execution environment/);
  });
});
