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

/**
 * Validates a server name or tool name segment used in the MCP tool naming convention.
 *
 * Returns an error message if the segment is invalid, or `null` if it is valid.
 * A segment is invalid when it:
 * - is empty or blank
 * - contains `__` (double underscore), which would make the composite name ambiguous
 */
export function validateMcpNameSegment(
  segment: string,
  role: 'serverName' | 'toolName'
): string | null {
  if (!segment || !segment.trim()) {
    return `MCP ${role} must not be empty`;
  }
  if (segment.includes('__')) {
    return `MCP ${role} "${segment}" must not contain "__" (double underscore) as it makes the tool name ambiguous`;
  }
  return null;
}
