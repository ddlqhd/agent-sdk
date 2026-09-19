import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Agent, createOpenAI, type StreamEvent } from '@ddlqhd/agent-sdk';
import { runTurn } from '@ddlqhd/agent-sdk-control';
import {
  createLocalEnvironment,
  startExecServer,
  type DnsLookupFn,
  type RunningExecServer
} from '@ddlqhd/agent-sdk-exec';
import { createCliAgent, destroyCliAgent } from '../../packages/agent-sdk-cli/src/utils/agent-bootstrap.js';
import {
  MOCK_ASSISTANT_TEXT,
  MOCK_TOOL_DONE_MARKER,
  startMockOpenAIServer
} from '../helpers/mock-openai-server.js';
import { cleanupIsolatedUserBasePaths, createIsolatedUserBasePath } from '../helpers/agent-test-defaults.js';

const PROBE_FILE = 'note.txt';
const PUBLIC_LOOKUP: DnsLookupFn = async () => [{ address: '93.184.216.34', family: 4 }];

function isolatedWorkspace(): { cwd: string; userBase: string } {
  const cwd = createIsolatedUserBasePath('exec-plane-cwd-');
  const userBase = createIsolatedUserBasePath('exec-plane-user-');
  writeFileSync(join(cwd, PROBE_FILE), 'hello world\n');
  return { cwd, userBase };
}

function toolResultText(events: StreamEvent[]): string {
  return events
    .filter((e): e is StreamEvent & { type: 'tool_result' } => e.type === 'tool_result')
    .map((e) => e.result)
    .join('\n');
}

function stubExampleHtmlFetch(html: string, contentType?: string): void {
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('example.com')) {
        return new Response(html, {
          status: 200,
          headers: contentType ? { 'content-type': contentType } : undefined
        });
      }
      return realFetch(input, init);
    }
  );
}

describe('exec plane against mock OpenAI API', () => {
  let mock: Awaited<ReturnType<typeof startMockOpenAIServer>>;
  let exec: RunningExecServer | undefined;

  beforeAll(async () => {
    mock = await startMockOpenAIServer();
  }, 20_000);

  afterEach(async () => {
    await exec?.close();
    exec = undefined;
    vi.unstubAllGlobals();
  }, 20_000);

  afterAll(async () => {
    await mock.close();
    cleanupIsolatedUserBasePaths();
  });

  it(
    'Edit via remote exec-server replaces the file',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      const target = join(cwd, PROBE_FILE);
      exec = await startExecServer({
        host: '127.0.0.1',
        port: 0,
        cwd,
        userHome: userBase,
        token: 'secret'
      });
      const { agent, fileLogger } = await createCliAgent({
        provider: 'openai',
        model: 'gpt-4.1',
        apiKey: 'sk-mock',
        baseUrl: mock.url,
        cwd,
        userBasePath: userBase,
        bare: true,
        logLevel: 'silent',
        execServer: exec.url,
        execToken: 'secret'
      });
      const events: StreamEvent[] = [];
      try {
        const result = await runTurn({
          agent,
          text: `Edit ${target} replace hello with world`,
          sink: { onEvent: (event) => { events.push(event); } }
        });
        expect(result.aborted).toBe(false);
        const names = events.filter((e) => e.type === 'tool_call').map((e) => e.name);
        expect(names).toContain('Edit');
        expect(result.finalText).toContain(MOCK_ASSISTANT_TEXT);
        expect(result.finalText).toContain(MOCK_TOOL_DONE_MARKER);
        expect(toolResultText(events)).toMatch(/Successfully edited/);
        expect(readFileSync(target, 'utf8')).toBe('world world\n');
      } finally {
        await destroyCliAgent(agent, fileLogger);
      }
    },
    30_000
  );

  it(
    'Bash oversized output spills on exec-server and stays Read-able',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      exec = await startExecServer({
        host: '127.0.0.1',
        port: 0,
        cwd,
        userHome: userBase,
        token: 'secret'
      });
      const { agent, fileLogger } = await createCliAgent({
        provider: 'openai',
        model: 'gpt-4.1',
        apiKey: 'sk-mock',
        baseUrl: mock.url,
        cwd,
        userBasePath: userBase,
        bare: true,
        logLevel: 'silent',
        execServer: exec.url,
        execToken: 'secret'
      });
      const events: StreamEvent[] = [];
      try {
        const result = await runTurn({
          agent,
          text: 'Print 60000 letter a with python',
          sink: { onEvent: (event) => { events.push(event); } }
        });
        expect(result.aborted).toBe(false);
        const names = events.filter((e) => e.type === 'tool_call').map((e) => e.name);
        expect(names).toContain('Bash');
        const output = toolResultText(events);
        expect(output).toContain('Output too large');
        expect(result.finalText).toContain(MOCK_TOOL_DONE_MARKER);
        const pathMatch = output.match(/Full output saved to: (.+)/);
        expect(pathMatch?.[1]).toBeTruthy();
        const spilledPath = pathMatch![1]!.trim();
        expect(spilledPath.startsWith(join(userBase, '.claude', 'tool-outputs'))).toBe(true);
        expect(readFileSync(spilledPath, 'utf8').length).toBe(60_000);
      } finally {
        await destroyCliAgent(agent, fileLogger);
      }
    },
    30_000
  );

  it(
    'Bash timeout still spills oversized output on exec-server',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      exec = await startExecServer({
        host: '127.0.0.1',
        port: 0,
        cwd,
        userHome: userBase,
        token: 'secret'
      });
      const { agent, fileLogger } = await createCliAgent({
        provider: 'openai',
        model: 'gpt-4.1',
        apiKey: 'sk-mock',
        baseUrl: mock.url,
        cwd,
        userBasePath: userBase,
        bare: true,
        logLevel: 'silent',
        execServer: exec.url,
        execToken: 'secret'
      });
      const events: StreamEvent[] = [];
      try {
        const result = await runTurn({
          agent,
          text: 'Print 60000 letter a with python then sleep until timeout',
          sink: { onEvent: (event) => { events.push(event); } }
        });
        expect(result.aborted).toBe(false);
        const names = events.filter((e) => e.type === 'tool_call').map((e) => e.name);
        expect(names).toContain('Bash');
        const output = toolResultText(events);
        expect(output).toContain('timed out');
        expect(output).toContain('Output too large');
        expect(result.finalText).toContain(MOCK_TOOL_DONE_MARKER);
        const pathMatch = output.match(/Full output saved to: (.+)/);
        expect(pathMatch?.[1]).toBeTruthy();
        const spilledPath = pathMatch![1]!.trim();
        expect(spilledPath.startsWith(join(userBase, '.claude', 'tool-outputs'))).toBe(true);
        expect(readFileSync(spilledPath, 'utf8').length).toBe(60_000);
      } finally {
        await destroyCliAgent(agent, fileLogger);
      }
    },
    30_000
  );

  it(
    'WebFetch converts HTML through the mock API on the local execution plane',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      stubExampleHtmlFetch(
        '<html><body><article><h1>Title</h1><p>Readable body.</p></article></body></html>',
        'text/html; charset=utf-8'
      );

      const agent = new Agent({
        model: createOpenAI({ apiKey: 'sk-mock', baseUrl: mock.url, model: 'gpt-4.1' }),
        cwd,
        userBasePath: userBase,
        memory: false,
        loadSkills: false,
        loadHookSettingsFromFiles: false,
        storage: { type: 'memory' },
        logLevel: 'silent',
        environment: createLocalEnvironment({
          workspaceRoot: cwd,
          userHome: userBase,
          dnsLookup: PUBLIC_LOOKUP
        })
      });
      await agent.waitForInit();
      const events: StreamEvent[] = [];
      try {
        const result = await runTurn({
          agent,
          text: 'Fetch http://example.com/page with WebFetch',
          sink: { onEvent: (event) => { events.push(event); } }
        });
        expect(result.aborted).toBe(false);
        const names = events.filter((e) => e.type === 'tool_call').map((e) => e.name);
        expect(names).toContain('WebFetch');
        expect(result.finalText).toContain(MOCK_ASSISTANT_TEXT);
        expect(result.finalText).toContain(MOCK_TOOL_DONE_MARKER);
        expect(toolResultText(events)).toMatch(/Readable body/);
        expect(toolResultText(events)).not.toContain('<html>');
      } finally {
        await agent.destroy();
      }
    },
    30_000
  );

  it(
    'WebFetch converts HTML through remote exec-server via the mock API',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      stubExampleHtmlFetch(
        '<html><body><article><h1>Title</h1><p>Remote readable body.</p></article></body></html>',
        'text/html; charset=utf-8'
      );
      exec = await startExecServer({
        host: '127.0.0.1',
        port: 0,
        cwd,
        userHome: userBase,
        token: 'secret',
        dnsLookup: PUBLIC_LOOKUP
      });
      const { agent, fileLogger } = await createCliAgent({
        provider: 'openai',
        model: 'gpt-4.1',
        apiKey: 'sk-mock',
        baseUrl: mock.url,
        cwd,
        userBasePath: userBase,
        bare: true,
        logLevel: 'silent',
        execServer: exec.url,
        execToken: 'secret'
      });
      const events: StreamEvent[] = [];
      try {
        const result = await runTurn({
          agent,
          text: 'Fetch http://example.com/page with WebFetch',
          sink: { onEvent: (event) => { events.push(event); } }
        });
        expect(result.aborted).toBe(false);
        const names = events.filter((e) => e.type === 'tool_call').map((e) => e.name);
        expect(names).toContain('WebFetch');
        expect(result.finalText).toContain(MOCK_TOOL_DONE_MARKER);
        expect(toolResultText(events)).toMatch(/Remote readable body/);
        expect(toolResultText(events)).not.toContain('<html>');
      } finally {
        await destroyCliAgent(agent, fileLogger);
      }
    },
    30_000
  );

  it(
    'WebFetch keeps raw tags when the mock page has no Content-Type',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      const html = '<html><body><p>Keep tags</p></body></html>';
      stubExampleHtmlFetch(html);
      exec = await startExecServer({
        host: '127.0.0.1',
        port: 0,
        cwd,
        userHome: userBase,
        token: 'secret',
        dnsLookup: PUBLIC_LOOKUP
      });
      const { agent, fileLogger } = await createCliAgent({
        provider: 'openai',
        model: 'gpt-4.1',
        apiKey: 'sk-mock',
        baseUrl: mock.url,
        cwd,
        userBasePath: userBase,
        bare: true,
        logLevel: 'silent',
        execServer: exec.url,
        execToken: 'secret'
      });
      const events: StreamEvent[] = [];
      try {
        const result = await runTurn({
          agent,
          text: 'Fetch http://example.com/page with WebFetch',
          sink: { onEvent: (event) => { events.push(event); } }
        });
        expect(result.aborted).toBe(false);
        expect(toolResultText(events)).toContain('<html>');
        expect(toolResultText(events)).toContain('Keep tags');
        expect(result.finalText).toContain(MOCK_TOOL_DONE_MARKER);
      } finally {
        await destroyCliAgent(agent, fileLogger);
      }
    },
    30_000
  );
});
