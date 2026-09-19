import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import * as acp from '@agentclientprotocol/sdk';
import type { StreamEvent } from '@ddlqhd/agent-sdk';
import { runTurn } from '@ddlqhd/agent-sdk-control';
import { createCliAgent, destroyCliAgent } from '../../packages/agent-sdk-cli/src/utils/agent-bootstrap.js';
import { createWebListener } from '../../packages/agent-sdk-cli/src/web/start-server.js';
import type { ClientMessage, ServerMessage } from '../../packages/agent-sdk-cli/src/web/shared/ws-protocol.js';
import { AgentSdkAcpBridge } from '../../packages/agent-sdk-acp/src/server.js';
import {
  MOCK_ASSISTANT_TEXT,
  MOCK_TOOL_DONE_MARKER,
  startMockOpenAIServer
} from '../helpers/mock-openai-server.js';
import { cleanupIsolatedUserBasePaths, createIsolatedUserBasePath } from '../helpers/agent-test-defaults.js';

const TEXT_PROMPT = 'Reply with the mock marker only.';
const GLOB_PROMPT = 'List files with Glob';
const PWD_PROMPT = 'Print working directory with pwd';
const PROBE_FILE = 'probe-ls.txt';

function isolatedWorkspace(): { cwd: string; userBase: string } {
  const cwd = createIsolatedUserBasePath('control-host-cwd-');
  const userBase = createIsolatedUserBasePath('control-host-user-');
  writeFileSync(join(cwd, PROBE_FILE), 'ok\n');
  return { cwd, userBase };
}

function waitForWs(ws: WebSocket, match: (msg: ServerMessage) => boolean, timeoutMs = 20_000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket wait timed out')), timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      if (match(msg)) {
        cleanup();
        resolve(msg);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

function collectWsUntil(
  ws: WebSocket,
  match: (msg: ServerMessage) => boolean,
  timeoutMs = 20_000
): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ServerMessage[] = [];
    const timer = setTimeout(() => reject(new Error('WebSocket wait timed out')), timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      messages.push(msg);
      if (match(msg)) {
        cleanup();
        resolve(messages);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

function expectSuccessfulToolTurn(
  finalText: string,
  toolNames: string[],
  expectedName: string,
  expectedSnippet: string
): void {
  expect(toolNames).toContain(expectedName);
  expect(finalText).toContain(MOCK_ASSISTANT_TEXT);
  expect(finalText).toContain(MOCK_TOOL_DONE_MARKER);
  expect(finalText).toContain(expectedSnippet);
}

describe('control hosts against mock OpenAI API', () => {
  let mock: Awaited<ReturnType<typeof startMockOpenAIServer>>;

  beforeAll(async () => {
    mock = await startMockOpenAIServer();
    process.env.OPENAI_API_KEY = 'sk-mock';
    process.env.OPENAI_BASE_URL = mock.url;
    process.env.AGENT_SDK_ACP_PROVIDER = 'openai';
    process.env.AGENT_SDK_ACP_MODEL = 'gpt-4.1';
  }, 20_000);

  afterAll(async () => {
    await mock.close();
    cleanupIsolatedUserBasePaths();
  });

  it(
    'CLI createCliAgent + runTurn returns mock text',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      const { agent, fileLogger } = await createCliAgent({
        provider: 'openai',
        model: 'gpt-4.1',
        apiKey: 'sk-mock',
        baseUrl: mock.url,
        cwd,
        userBasePath: userBase,
        bare: true,
        logLevel: 'silent'
      });
      try {
        const result = await runTurn({ agent, text: TEXT_PROMPT });
        expect(result.aborted).toBe(false);
        expect(result.finalText).toContain(MOCK_ASSISTANT_TEXT);
        expect(result.finalText).not.toContain(MOCK_TOOL_DONE_MARKER);
      } finally {
        await destroyCliAgent(agent, fileLogger);
      }
    },
    30_000
  );

  it(
    'CLI Glob lists workspace files',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      const { agent, fileLogger } = await createCliAgent({
        provider: 'openai',
        model: 'gpt-4.1',
        apiKey: 'sk-mock',
        baseUrl: mock.url,
        cwd,
        userBasePath: userBase,
        bare: true,
        logLevel: 'silent'
      });
      const events: StreamEvent[] = [];
      try {
        const result = await runTurn({
          agent,
          text: GLOB_PROMPT,
          sink: { onEvent: (event: StreamEvent) => { events.push(event); } }
        });
        expect(result.aborted).toBe(false);
        const names = events.filter((e) => e.type === 'tool_call').map((e) => e.name);
        expectSuccessfulToolTurn(result.finalText, names, 'Glob', PROBE_FILE);
      } finally {
        await destroyCliAgent(agent, fileLogger);
      }
    },
    30_000
  );

  it(
    'CLI Bash pwd is side-effect-free and returns cwd',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      const { agent, fileLogger } = await createCliAgent({
        provider: 'openai',
        model: 'gpt-4.1',
        apiKey: 'sk-mock',
        baseUrl: mock.url,
        cwd,
        userBasePath: userBase,
        bare: true,
        logLevel: 'silent'
      });
      const events: StreamEvent[] = [];
      try {
        const result = await runTurn({
          agent,
          text: PWD_PROMPT,
          sink: { onEvent: (event: StreamEvent) => { events.push(event); } }
        });
        expect(result.aborted).toBe(false);
        const names = events.filter((e) => e.type === 'tool_call').map((e) => e.name);
        expectSuccessfulToolTurn(result.finalText, names, 'Bash', cwd);
      } finally {
        await destroyCliAgent(agent, fileLogger);
      }
    },
    30_000
  );

  it(
    'Web WS configure + chat returns mock text',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      const clientDist = mkdtempSync(join(tmpdir(), 'agent-sdk-web-dist-'));
      writeFileSync(join(clientDist, 'index.html'), '<html></html>');
      const port = 18000 + Math.floor(Math.random() * 1000);
      const handle = await createWebListener({
        port,
        host: '127.0.0.1',
        clientDist,
        defaults: {
          cwd,
          userBasePath: userBase,
          provider: 'openai',
          model: 'gpt-4.1',
          apiKey: 'sk-mock',
          baseUrl: mock.url,
          logLevel: 'silent'
        }
      });

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        origin: `http://127.0.0.1:${port}`
      });
      try {
        await new Promise<void>((resolve, reject) => {
          ws.once('open', () => resolve());
          ws.once('error', reject);
        });
        const send = (msg: ClientMessage) => ws.send(JSON.stringify(msg));
        send({ type: 'hello' });
        await waitForWs(ws, (m) => m.type === 'hello_ok');
        send({
          type: 'configure',
          provider: 'openai',
          model: 'gpt-4.1',
          storage: 'memory',
          memory: false,
          contextManagement: false,
          safeToolsOnly: true,
          cwd,
          userBasePath: userBase
        });
        const ready = await waitForWs(ws, (m) => m.type === 'ready' || m.type === 'error');
        expect(ready.type).toBe('ready');
        if (ready.type !== 'ready') throw new Error(JSON.stringify(ready));
        send({ type: 'chat', text: TEXT_PROMPT, requestId: 'req-1', sessionId: ready.sessionId ?? undefined });
        const done = await waitForWs(ws, (m) => m.type === 'chat_done' || m.type === 'error');
        expect(done.type).toBe('chat_done');
        if (done.type === 'chat_done') {
          expect(done.finalText).toContain(MOCK_ASSISTANT_TEXT);
          expect(done.finalText).not.toContain(MOCK_TOOL_DONE_MARKER);
        }
      } finally {
        ws.close();
        await handle.close();
      }
    },
    30_000
  );

  it(
    'Web Glob works with safeToolsOnly',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      const clientDist = mkdtempSync(join(tmpdir(), 'agent-sdk-web-dist-'));
      writeFileSync(join(clientDist, 'index.html'), '<html></html>');
      const port = 18000 + Math.floor(Math.random() * 1000);
      const handle = await createWebListener({
        port,
        host: '127.0.0.1',
        clientDist,
        defaults: {
          cwd,
          userBasePath: userBase,
          provider: 'openai',
          model: 'gpt-4.1',
          apiKey: 'sk-mock',
          baseUrl: mock.url,
          logLevel: 'silent'
        }
      });

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        origin: `http://127.0.0.1:${port}`
      });
      try {
        await new Promise<void>((resolve, reject) => {
          ws.once('open', () => resolve());
          ws.once('error', reject);
        });
        const send = (msg: ClientMessage) => ws.send(JSON.stringify(msg));
        send({ type: 'hello' });
        await waitForWs(ws, (m) => m.type === 'hello_ok');
        send({
          type: 'configure',
          provider: 'openai',
          model: 'gpt-4.1',
          storage: 'memory',
          memory: false,
          contextManagement: false,
          safeToolsOnly: true,
          cwd,
          userBasePath: userBase
        });
        const ready = await waitForWs(ws, (m) => m.type === 'ready' || m.type === 'error');
        expect(ready.type).toBe('ready');
        if (ready.type !== 'ready') throw new Error(JSON.stringify(ready));
        send({ type: 'chat', text: GLOB_PROMPT, requestId: 'req-glob', sessionId: ready.sessionId ?? undefined });
        const messages = await collectWsUntil(ws, (m) => m.type === 'chat_done' || m.type === 'error');
        const done = messages[messages.length - 1];
        expect(done.type).toBe('chat_done');
        const names = messages
          .filter((m) => m.type === 'stream_event' && m.event.type === 'tool_call')
          .map((m) => (m.type === 'stream_event' ? String(m.event.name ?? '') : ''));
        if (done.type === 'chat_done') {
          expectSuccessfulToolTurn(done.finalText, names, 'Glob', PROBE_FILE);
        }
      } finally {
        ws.close();
        await handle.close();
      }
    },
    30_000
  );

  it(
    'Web Bash pwd works when safeToolsOnly is off',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      const clientDist = mkdtempSync(join(tmpdir(), 'agent-sdk-web-dist-'));
      writeFileSync(join(clientDist, 'index.html'), '<html></html>');
      const port = 18000 + Math.floor(Math.random() * 1000);
      const handle = await createWebListener({
        port,
        host: '127.0.0.1',
        clientDist,
        defaults: {
          cwd,
          userBasePath: userBase,
          provider: 'openai',
          model: 'gpt-4.1',
          apiKey: 'sk-mock',
          baseUrl: mock.url,
          logLevel: 'silent'
        }
      });

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        origin: `http://127.0.0.1:${port}`
      });
      try {
        await new Promise<void>((resolve, reject) => {
          ws.once('open', () => resolve());
          ws.once('error', reject);
        });
        const send = (msg: ClientMessage) => ws.send(JSON.stringify(msg));
        send({ type: 'hello' });
        await waitForWs(ws, (m) => m.type === 'hello_ok');
        send({
          type: 'configure',
          provider: 'openai',
          model: 'gpt-4.1',
          storage: 'memory',
          memory: false,
          contextManagement: false,
          safeToolsOnly: false,
          cwd,
          userBasePath: userBase
        });
        const ready = await waitForWs(ws, (m) => m.type === 'ready' || m.type === 'error');
        expect(ready.type).toBe('ready');
        if (ready.type !== 'ready') throw new Error(JSON.stringify(ready));
        send({ type: 'chat', text: PWD_PROMPT, requestId: 'req-pwd', sessionId: ready.sessionId ?? undefined });
        const messages = await collectWsUntil(ws, (m) => m.type === 'chat_done' || m.type === 'error');
        const done = messages[messages.length - 1];
        expect(done.type).toBe('chat_done');
        const names = messages
          .filter((m) => m.type === 'stream_event' && m.event.type === 'tool_call')
          .map((m) => (m.type === 'stream_event' ? String(m.event.name ?? '') : ''));
        if (done.type === 'chat_done') {
          expectSuccessfulToolTurn(done.finalText, names, 'Bash', cwd);
        }
      } finally {
        ws.close();
        await handle.close();
      }
    },
    30_000
  );

  it(
    'ACP initialize + session/new + prompt returns mock text',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      process.env.AGENT_SDK_ACP_USER_BASE = userBase;
      process.env.OPENAI_API_KEY = 'sk-mock';
      process.env.OPENAI_BASE_URL = mock.url;
      mkdirSync(join(cwd, '.claude'), { recursive: true });

      const toAgent = new TransformStream();
      const toClient = new TransformStream();
      const chunks: string[] = [];
      let bridge: AgentSdkAcpBridge | null = null;

      new acp.AgentSideConnection((conn) => {
        bridge = new AgentSdkAcpBridge(conn);
        return bridge;
      }, {
        readable: toAgent.readable,
        writable: toClient.writable
      });

      const client = new acp.ClientSideConnection(
        () => ({
          async requestPermission() {
            return { outcome: { outcome: 'cancelled' } };
          },
          async sessionUpdate(params) {
            const update = params.update;
            if (
              update.sessionUpdate === 'agent_message_chunk' &&
              update.content.type === 'text'
            ) {
              chunks.push(update.content.text);
            }
          }
        }),
        {
          readable: toClient.readable,
          writable: toAgent.writable
        }
      );

      try {
        await client.initialize({
          protocolVersion: acp.PROTOCOL_VERSION,
          clientInfo: { name: 'control-host-test', version: '0' }
        });
        const session = await client.newSession({ cwd, mcpServers: [] });
        expect(session.sessionId).toBeTruthy();
        const prompt = await client.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: TEXT_PROMPT }]
        });
        expect(prompt.stopReason).toBe('end_turn');
        expect(chunks.join('')).toContain(MOCK_ASSISTANT_TEXT);
        expect(chunks.join('')).not.toContain(MOCK_TOOL_DONE_MARKER);
      } finally {
        await bridge?.sessionManager.destroyAll();
      }
    },
    45_000
  );

  it(
    'ACP Glob is auto-approved and lists files',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      process.env.AGENT_SDK_ACP_USER_BASE = userBase;
      process.env.OPENAI_API_KEY = 'sk-mock';
      process.env.OPENAI_BASE_URL = mock.url;
      mkdirSync(join(cwd, '.claude'), { recursive: true });

      const toAgent = new TransformStream();
      const toClient = new TransformStream();
      const chunks: string[] = [];
      const toolTitles: string[] = [];
      let permissionAsked = false;
      let bridge: AgentSdkAcpBridge | null = null;

      new acp.AgentSideConnection((conn) => {
        bridge = new AgentSdkAcpBridge(conn);
        return bridge;
      }, {
        readable: toAgent.readable,
        writable: toClient.writable
      });

      const client = new acp.ClientSideConnection(
        () => ({
          async requestPermission() {
            permissionAsked = true;
            return { outcome: { outcome: 'cancelled' } };
          },
          async sessionUpdate(params) {
            const update = params.update;
            if (update.sessionUpdate === 'tool_call') {
              toolTitles.push(update.title ?? '');
            }
            if (
              update.sessionUpdate === 'agent_message_chunk' &&
              update.content.type === 'text'
            ) {
              chunks.push(update.content.text);
            }
          }
        }),
        {
          readable: toClient.readable,
          writable: toAgent.writable
        }
      );

      try {
        await client.initialize({
          protocolVersion: acp.PROTOCOL_VERSION,
          clientInfo: { name: 'control-host-test', version: '0' }
        });
        const session = await client.newSession({ cwd, mcpServers: [] });
        const prompt = await client.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: GLOB_PROMPT }]
        });
        expect(prompt.stopReason).toBe('end_turn');
        expect(permissionAsked).toBe(false);
        expect(toolTitles.some((t) => t.includes('Glob'))).toBe(true);
        const text = chunks.join('');
        expect(text).toContain(MOCK_ASSISTANT_TEXT);
        expect(text).toContain(MOCK_TOOL_DONE_MARKER);
        expect(text).toContain(PROBE_FILE);
      } finally {
        await bridge?.sessionManager.destroyAll();
      }
    },
    45_000
  );

  it(
    'ACP Bash pwd runs after allow_once',
    async () => {
      const { cwd, userBase } = isolatedWorkspace();
      process.env.AGENT_SDK_ACP_USER_BASE = userBase;
      process.env.OPENAI_API_KEY = 'sk-mock';
      process.env.OPENAI_BASE_URL = mock.url;
      mkdirSync(join(cwd, '.claude'), { recursive: true });

      const toAgent = new TransformStream();
      const toClient = new TransformStream();
      const chunks: string[] = [];
      const toolTitles: string[] = [];
      let permissionAsked = false;
      let bridge: AgentSdkAcpBridge | null = null;

      new acp.AgentSideConnection((conn) => {
        bridge = new AgentSdkAcpBridge(conn);
        return bridge;
      }, {
        readable: toAgent.readable,
        writable: toClient.writable
      });

      const client = new acp.ClientSideConnection(
        () => ({
          async requestPermission() {
            permissionAsked = true;
            return { outcome: { outcome: 'selected', optionId: 'allow_once' } };
          },
          async sessionUpdate(params) {
            const update = params.update;
            if (update.sessionUpdate === 'tool_call') {
              toolTitles.push(update.title ?? '');
            }
            if (
              update.sessionUpdate === 'agent_message_chunk' &&
              update.content.type === 'text'
            ) {
              chunks.push(update.content.text);
            }
          }
        }),
        {
          readable: toClient.readable,
          writable: toAgent.writable
        }
      );

      try {
        await client.initialize({
          protocolVersion: acp.PROTOCOL_VERSION,
          clientInfo: { name: 'control-host-test', version: '0' }
        });
        const session = await client.newSession({ cwd, mcpServers: [] });
        const prompt = await client.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: PWD_PROMPT }]
        });
        expect(prompt.stopReason).toBe('end_turn');
        expect(permissionAsked).toBe(true);
        expect(toolTitles.some((t) => t.includes('Bash'))).toBe(true);
        const text = chunks.join('');
        expect(text).toContain(MOCK_ASSISTANT_TEXT);
        expect(text).toContain(MOCK_TOOL_DONE_MARKER);
        expect(text).toContain(cwd);
      } finally {
        await bridge?.sessionManager.destroyAll();
      }
    },
    45_000
  );
});
