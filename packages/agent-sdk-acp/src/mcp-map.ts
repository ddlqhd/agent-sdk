import type * as acp from '@agentclientprotocol/sdk';
import type { MCPServerConfig } from '@ddlqhd/agent-sdk';
import { logInfo } from './logging.js';

function kvArrayToRecord(items: Array<{ name: string; value: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    if (item.name) {
      out[item.name] = item.value ?? '';
    }
  }
  return out;
}

export function mapAcpMcpServers(servers?: acp.McpServer[]): MCPServerConfig[] | undefined {
  if (!servers?.length) return undefined;

  const mapped: MCPServerConfig[] = [];

  for (const server of servers) {
    if ('type' in server) {
      if (server.type === 'http') {
        mapped.push({
          name: server.name,
          transport: 'http',
          url: server.url,
          headers: kvArrayToRecord(server.headers)
        });
        continue;
      }
      if (server.type === 'sse' || server.type === 'acp') {
        const name = 'name' in server ? server.name : 'unknown';
        logInfo('mcp-map skip', `unsupported transport ${server.type} (${name})`);
        continue;
      }
    }

    if ('command' in server) {
      mapped.push({
        name: server.name,
        transport: 'stdio',
        command: server.command,
        args: server.args,
        env: kvArrayToRecord(server.env)
      });
    }
  }

  return mapped.length > 0 ? mapped : undefined;
}
