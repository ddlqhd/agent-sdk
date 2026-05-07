import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MCPAdapter } from '../../src/mcp/adapter.js';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

const tools = [{ name: 'echo', inputSchema: { type: 'object' as const } }];
const connectMock = vi.fn<[], Promise<void>>(() => Promise.resolve());
const disconnectMock = vi.fn<[], Promise<void>>(() => Promise.resolve());
const toToolDefinitionsMock = vi.fn().mockImplementation(() => [
  {
    name: 'mcp__server-a__echo',
    description: 'echo',
    parameters: { type: 'object' as const },
    handler: async () => ({ content: 'ok' })
  }
]);

vi.mock('../../src/mcp/client.js', () => ({
  MCPClient: class {
    tools = tools;
    connect = connectMock;
    disconnect = disconnectMock;
    toToolDefinitions = toToolDefinitionsMock;
  }
}));

describe('MCPAdapter.addServer connect timeout', () => {
  beforeEach(() => {
    connectMock.mockReset();
    disconnectMock.mockClear();
    toToolDefinitionsMock.mockClear();
    vi.useRealTimers();
  });

  it('registers client and tools when connect succeeds', async () => {
    connectMock.mockResolvedValueOnce();
    const adapter = new MCPAdapter();

    await adapter.addServer({
      name: 'server-a',
      transport: 'stdio',
      command: 'node',
      connectTimeoutMs: 50
    });

    expect(adapter.size).toBe(1);
    expect(adapter.getServerNames()).toEqual(['server-a']);
    expect(adapter.getToolDefinitions().map(t => t.name)).toEqual(['mcp__server-a__echo']);
  });

  it('throws when connect exceeds timeout', async () => {
    vi.useFakeTimers();
    connectMock.mockImplementation(() => new Promise<void>(() => undefined));
    const adapter = new MCPAdapter();

    const task = adapter.addServer({
      name: 'slow-server',
      transport: 'stdio',
      command: 'node',
      connectTimeoutMs: 10
    });
    const rejected = expect(task).rejects.toThrow(
      'MCP server "slow-server" connect timed out after 10ms'
    );

    await vi.advanceTimersByTimeAsync(11);
    await rejected;
    expect(adapter.size).toBe(0);
  });

  it('disconnects when a timed-out connect eventually succeeds', async () => {
    vi.useRealTimers();
    const deferred = createDeferred();
    connectMock.mockImplementation(() => deferred.promise);
    const adapter = new MCPAdapter();

    const task = adapter.addServer({
      name: 'late-server',
      transport: 'stdio',
      command: 'node',
      connectTimeoutMs: 10
    });
    await expect(task).rejects.toThrow('MCP server "late-server" connect timed out after 10ms');
    expect(disconnectMock).not.toHaveBeenCalled();

    deferred.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});
