import type { MCPServerConfig, ToolDefinition, ToolResult } from '../core/types.js';
import { MCPClient, type MCPTool } from './client.js';
import { formatMcpToolName } from './mcp-tool-name.js';

const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 30_000;

export class MCPAdapter {
  private clients: Map<string, MCPClient> = new Map();
  private toolMap: Map<string, { client: MCPClient; toolName: string }> = new Map();

  async addServer(config: MCPServerConfig): Promise<void> {
    if (this.clients.has(config.name)) {
      throw new Error(`MCP server "${config.name}" already exists`);
    }

    const client = new MCPClient(config);
    const timeoutMs = normalizeConnectTimeoutMs(config.connectTimeoutMs);
    const connectPromise = client.connect();

    try {
      await withTimeout(
        connectPromise,
        timeoutMs,
        `MCP server "${config.name}" connect timed out after ${timeoutMs}ms`
      );
    } catch (error) {
      // Eagerly clean up: if the underlying connect eventually succeeds, disconnect
      // immediately so the subprocess/socket is not left dangling indefinitely.
      void connectPromise
        .then(() => client.disconnect())
        .catch(() => undefined);
      // Also attempt a best-effort disconnect right now in case the transport
      // has already opened (e.g. stdio process spawned but handshake hung).
      void client.disconnect().catch(() => undefined);
      throw error;
    }

    this.clients.set(config.name, client);

    for (const tool of client.tools) {
      const fullName = formatMcpToolName(config.name, tool.name);
      this.toolMap.set(fullName, { client, toolName: tool.name });
    }
  }

  async removeServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) return;

    for (const [fullName, { client: c }] of this.toolMap.entries()) {
      if (c === client) {
        this.toolMap.delete(fullName);
      }
    }

    await client.disconnect();
    this.clients.delete(name);
  }

  getToolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    for (const client of this.clients.values()) {
      tools.push(...client.toToolDefinitions());
    }

    return tools;
  }

  async executeTool(fullName: string, args: unknown): Promise<ToolResult> {
    const mapping = this.toolMap.get(fullName);
    if (!mapping) {
      return {
        content: `MCP tool "${fullName}" not found`,
        isError: true
      };
    }

    return mapping.client.callTool(mapping.toolName, args);
  }

  getClient(name: string): MCPClient | undefined {
    return this.clients.get(name);
  }

  getServerNames(): string[] {
    return Array.from(this.clients.keys());
  }

  isConnected(name: string): boolean {
    const client = this.clients.get(name);
    return client?.connected ?? false;
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect();
    }
    this.clients.clear();
    this.toolMap.clear();
  }

  async listAllTools(): Promise<Map<string, MCPTool[]>> {
    const result = new Map<string, MCPTool[]>();

    for (const [name, client] of this.clients) {
      const tools = await client.listTools();
      result.set(name, tools);
    }

    return result;
  }

  async listAllResources(): Promise<Map<string, Awaited<ReturnType<MCPClient['listResources']>>>> {
    const result = new Map();

    for (const [name, client] of this.clients) {
      const resources = await client.listResources();
      result.set(name, resources);
    }

    return result;
  }

  get size(): number {
    return this.clients.size;
  }
}

export function createMCPAdapter(): MCPAdapter {
  return new MCPAdapter();
}

function normalizeConnectTimeoutMs(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_MCP_CONNECT_TIMEOUT_MS;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    void promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}