import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLocalEnvironment, type Environment } from '@ddlqhd/agent-sdk-exec';
import { MCPClient } from '../../packages/agent-sdk/src/mcp/client.js';
import { EnvironmentStdioTransport } from '../../packages/agent-sdk/src/mcp/environment-stdio-transport.js';

function asRemote(env: Environment): Environment {
  return { ...env, kind: 'remote' };
}

function writeMockMcp(root: string, extraTools = 0): string {
  const extra = Array.from({ length: extraTools }, (_, i) => ({
    name: `tool-${i}`,
    description: `d-${i}-${'x'.repeat(80)}`,
    inputSchema: { type: 'object', properties: {} }
  }));
  const script = `
const readline = require('readline');
const extra = ${JSON.stringify(extra)};
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line) return;
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-exec-mcp', version: '0.0.1' }
      }
    }) + '\\n');
    return;
  }
  if (msg.method === 'notifications/initialized') {
    return;
  }
  if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [{
          name: 'ping',
          description: 'ping',
          inputSchema: { type: 'object', properties: {} }
        }].concat(extra)
      }
    }) + '\\n');
  }
});
`;
  const scriptPath = join(root, extraTools > 0 ? 'mock-mcp-large.cjs' : 'mock-mcp.cjs');
  writeFileSync(scriptPath, script);
  return scriptPath;
}

describe('MCPClient Environment stdio transport', () => {
  it('lists tools from a local Environment via official stdio', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-env-stdio-'));
    const script = writeMockMcp(root);
    const env = createLocalEnvironment({ workspaceRoot: root });

    const client = new MCPClient(
      {
        name: 'mock-exec',
        transport: 'stdio',
        command: process.execPath,
        args: [script],
        cwd: root
      },
      { environment: env }
    );

    try {
      await client.connect();
      const tools = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(['ping']);
    } finally {
      await client.disconnect().catch(() => undefined);
    }
  });

  it('reads a tools/list larger than the Bash 32k default on a remote Environment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-env-stdio-large-'));
    const script = writeMockMcp(root, 500);
    const env = asRemote(createLocalEnvironment({ workspaceRoot: root }));

    const client = new MCPClient(
      {
        name: 'mock-large',
        transport: 'stdio',
        command: process.execPath,
        args: [script],
        cwd: root
      },
      { environment: env }
    );

    try {
      await client.connect();
      const tools = await client.listTools();
      expect(tools.length).toBe(501);
      expect(tools[500]!.name).toBe('tool-499');
    } finally {
      await client.disconnect().catch(() => undefined);
    }
  });

  it('emits onclose once when the transport is closed after the child exits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-env-stdio-close-'));
    const script = join(root, 'exit-now.cjs');
    writeFileSync(script, 'setTimeout(() => process.exit(0), 50);\n');
    const env = createLocalEnvironment({ workspaceRoot: root });
    const transport = new EnvironmentStdioTransport({
      environment: env,
      command: process.execPath,
      args: [script],
      cwd: root
    });
    let closes = 0;
    transport.onclose = () => {
      closes += 1;
    };
    await transport.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await transport.close();
    expect(closes).toBe(1);
  });
});
