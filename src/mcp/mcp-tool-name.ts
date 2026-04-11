/**
 * Builds the Agent-facing tool name for an MCP tool: `mcp__<serverName>__<toolName>`.
 * Avoid `__` inside `serverName` or `toolName`; those segments are not escaped and would make parsing ambiguous.
 */
export function formatMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

/**
 * True if `name` matches the MCP-prefixed tool naming convention (at least `mcp__<server>__<tool>`).
 */
export function isMcpPrefixedToolName(name: string): boolean {
  if (!name.startsWith('mcp__')) {
    return false;
  }
  return name.slice('mcp__'.length).includes('__');
}
