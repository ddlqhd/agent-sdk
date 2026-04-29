import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { MCPServerConfig, ToolDefinition, ToolExecutionContext, ToolResult } from '../core/types.js';
import { PACKAGE_VERSION } from '../version.js';
import { formatMcpToolName } from './mcp-tool-name.js';

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class MCPClient {
  private client: Client;
  private transport: Transport;
  private _name: string;
  private _connected = false;
  private _tools: MCPTool[] = [];
  private _serverInfo?: { name: string; version: string };
  private readonly _toolTimeoutMs?: number;

  constructor(config: MCPServerConfig) {
    this._name = config.name;
    const t = config.toolTimeoutMs;
    this._toolTimeoutMs =
      typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : undefined;

    this.client = new Client(
      { name: 'agent-sdk-client', version: PACKAGE_VERSION },
      { capabilities: {} }
    );

    if (config.transport === 'stdio') {
      if (!config.command) {
        throw new Error(`MCP server "${config.name}": stdio transport requires command`);
      }
      const cwd = (config.cwd ?? '').trim();
      this.transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        ...(cwd !== '' ? { cwd } : {})
      });
    } else {
      if (!config.url) {
        throw new Error(`MCP server "${config.name}": http transport requires url`);
      }
      this.transport = new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: config.headers } }
      );
    }
  }

  async connect(): Promise<void> {
    if (this._connected) return;

    await this.client.connect(this.transport);
    this._connected = true;

    const serverInfo = this.client.getServerVersion();
    if (serverInfo) {
      this._serverInfo = {
        name: serverInfo.name,
        version: serverInfo.version
      };
    }

    await this.listTools();
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;

    await this.client.close();
    this._connected = false;
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.client.listTools();
    this._tools = result.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as MCPTool['inputSchema']
    }));
    return this._tools;
  }

  async callTool(name: string, args: unknown, signal?: AbortSignal): Promise<ToolResult> {
    const params = {
      name,
      arguments: args as Record<string, unknown>
    };

    const requestOptions: RequestOptions = {};
    if (this._toolTimeoutMs !== undefined) {
      requestOptions.timeout = this._toolTimeoutMs;
    }
    if (signal) {
      requestOptions.signal = signal;
    }
    const useRequestOptions =
      requestOptions.timeout !== undefined || requestOptions.signal !== undefined;

    try {
      const result = useRequestOptions
        ? await this.client.callTool(params, undefined, requestOptions)
        : await this.client.callTool(params);

      if ('toolResult' in result) {
        return {
          content: JSON.stringify(result.toolResult),
          isError: false
        };
      }

      const content = result.content
        .map(c => {
          if (c.type === 'text') return c.text;
          if (c.type === 'image') return `[Image: ${c.mimeType}]`;
          if (c.type === 'resource') {
            const res = c.resource;
            if ('text' in res) return res.text;
            if ('blob' in res) return `[Blob: ${res.mimeType}]`;
            return '';
          }
          return JSON.stringify(c);
        })
        .join('\n');

      return {
        content,
        isError: result.isError ?? false
      };
    } catch (error) {
      return {
        content: formatMcpToolCallFailure(name, error),
        isError: true
      };
    }
  }

  async listResources(): Promise<MCPResource[]> {
    const result = await this.client.listResources();
    return result.resources.map(r => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType
    }));
  }

  async readResource(uri: string): Promise<string> {
    const result = await this.client.readResource({ uri });
    const content = result.contents[0];
    if (!content) return '';
    if ('text' in content) return content.text;
    if ('blob' in content) return content.blob;
    return '';
  }

  async listPrompts(): Promise<MCPPrompt[]> {
    const result = await this.client.listPrompts();
    return result.prompts.map((p: { name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments?.map((a: { name: string; description?: string; required?: boolean }) => ({
        name: a.name,
        description: a.description,
        required: a.required
      }))
    }));
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<PromptMessage[]> {
    const result = await this.client.getPrompt({
      name,
      arguments: args
    });

    return result.messages.map(m => ({
      role: m.role,
      content: m.content.type === 'text' ? m.content.text : JSON.stringify(m.content)
    }));
  }

  toToolDefinitions(): ToolDefinition[] {
    return this._tools.map(tool => ({
      name: formatMcpToolName(this._name, tool.name),
      description: tool.description || `MCP tool: ${tool.name}`,
      parameters: this.convertSchema(tool.inputSchema),
      handler: async (args: unknown, context?: ToolExecutionContext) =>
        this.callTool(tool.name, args, context?.signal),
      category: 'mcp'  // 标记为 MCP 类别，用于输出处理策略选择
    }));
  }

  private convertSchema(schema?: MCPTool['inputSchema']): z.ZodType {
    if (!schema || !schema.properties) {
      return z.looseObject({});
    }

    const shape: Record<string, z.ZodType> = {};

    for (const [key, value] of Object.entries(schema.properties)) {
      const field = value as { type?: string; description?: string };
      let zodField: z.ZodType;

      switch (field.type) {
        case 'string':
          zodField = z.string();
          break;
        case 'number':
        case 'integer':
          zodField = z.number();
          break;
        case 'boolean':
          zodField = z.boolean();
          break;
        case 'array':
          zodField = z.array(z.any());
          break;
        case 'object':
          zodField = z.looseObject({});
          break;
        default:
          zodField = z.any();
      }

      if (field.description) {
        zodField = zodField.describe(field.description);
      }

      if (!schema.required?.includes(key)) {
        zodField = zodField.optional();
      }

      shape[key] = zodField;
    }

    return z.object(shape);
  }

  get name(): string {
    return this._name;
  }

  get connected(): boolean {
    return this._connected;
  }

  get serverInfo(): { name: string; version: string } | undefined {
    return this._serverInfo;
  }

  get tools(): MCPTool[] {
    return this._tools;
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === 'AbortError') {
    return true;
  }
  return (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  );
}

function formatMcpToolCallFailure(toolName: string, error: unknown): string {
  if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
    return `MCP tool "${toolName}" timed out: ${error.message}`;
  }
  if (isAbortError(error)) {
    const msg = error instanceof Error ? error.message : String(error);
    return msg ? `MCP tool "${toolName}" aborted: ${msg}` : `MCP tool "${toolName}" aborted`;
  }
  return `MCP tool error: ${error instanceof Error ? error.message : String(error)}`;
}

export function createMCPClient(config: MCPServerConfig): MCPClient {
  return new MCPClient(config);
}