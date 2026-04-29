import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSdkCallTool = vi.fn().mockResolvedValue({ content: [], isError: false });

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = vi.fn();
    close = vi.fn();
    listTools = vi.fn().mockResolvedValue({ tools: [] });
    callTool = (...args: unknown[]) => mockSdkCallTool(...args);
    getServerVersion = vi.fn().mockReturnValue(null);
  }
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {}
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {}
}));

import { MCPClient } from '../../src/mcp/client.js';

describe('MCPClient.callTool RequestOptions', () => {
  beforeEach(() => {
    mockSdkCallTool.mockClear();
  });

  it('forwards timeout from toolTimeoutMs', async () => {
    const c = new MCPClient({
      name: 'srv',
      transport: 'stdio',
      command: 'node',
      toolTimeoutMs: 42
    });
    await c.callTool('mytool', { a: 1 });
    expect(mockSdkCallTool).toHaveBeenCalledTimes(1);
    expect(mockSdkCallTool).toHaveBeenCalledWith(
      { name: 'mytool', arguments: { a: 1 } },
      undefined,
      { timeout: 42 }
    );
  });

  it('forwards AbortSignal without custom timeout', async () => {
    const c = new MCPClient({
      name: 'srv',
      transport: 'stdio',
      command: 'node'
    });
    const ac = new AbortController();
    await c.callTool('t', {}, ac.signal);
    expect(mockSdkCallTool).toHaveBeenCalledWith(
      { name: 't', arguments: {} },
      undefined,
      { signal: ac.signal }
    );
  });

  it('combines timeout and signal', async () => {
    const c = new MCPClient({
      name: 'srv',
      transport: 'stdio',
      command: 'node',
      toolTimeoutMs: 100
    });
    const ac = new AbortController();
    await c.callTool('t', {}, ac.signal);
    expect(mockSdkCallTool).toHaveBeenCalledWith(
      { name: 't', arguments: {} },
      undefined,
      { timeout: 100, signal: ac.signal }
    );
  });

  it('uses single-arg SDK callTool when no timeout and no signal', async () => {
    const c = new MCPClient({
      name: 'srv',
      transport: 'stdio',
      command: 'node'
    });
    await c.callTool('t', {});
    expect(mockSdkCallTool).toHaveBeenCalledWith({ name: 't', arguments: {} });
  });
});
