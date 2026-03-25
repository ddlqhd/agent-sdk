import type { ToolDefinition, ToolResult } from '../core/types.js';
import { MCPClient, type MCPClientConfig, type MCPTool } from './client.js';

export class MCPAdapter {
  private clients: Map<string, MCPClient> = new Map();
  private toolMap: Map<string, { client: MCPClient; toolName: string }> = new Map();

  async addServer(config: MCPClientConfig): Promise<void> {
    if (this.clients.has(config.name)) {
      throw new Error(`MCP server "${config.name}" already exists`);
    }

    const client = new MCPClient(config);
    await client.connect();

    this.clients.set(config.name, client);

    for (const tool of client.tools) {
      const fullName = `mcp_${config.name}__${tool.name}`;
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