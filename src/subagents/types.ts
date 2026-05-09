/**
 * Subagent profile: Claude Code–compatible markdown frontmatter + programmatic config.
 */

export type SubagentProfileSource = 'builtin' | 'file' | 'config';

/** Reserved / parsed for future use; not all fields affect runtime yet. */
export interface SubagentReservedFields {
  model?: string;
  permissionMode?: string;
  maxTurns?: number;
  skills?: string[];
  mcpServers?: unknown;
  hooks?: unknown;
  memory?: string;
  background?: boolean;
  initialPrompt?: string;
}

export interface SubagentProfile extends SubagentReservedFields {
  name: string;
  description: string;
  /** Markdown body or CLI `prompt` — specialist system instructions. */
  promptBody?: string;
  /** TS-built-in fragment only (e.g. explore). */
  builtinSystemFragment?: string;
  /** Allowlist of tool names (Claude `tools`). */
  tools?: string[];
  /** Denylist applied before allowlist resolution (Claude `disallowedTools`). */
  disallowedTools?: string[];
  /**
   * When profile has no **`tools`** and **`AgentConfig.subagent.defaultAllowedTools`** is unset or empty,
   * use these names (e.g. built-in explore defaults).
   */
  defaultToolNames?: string[];
  source?: SubagentProfileSource;
  filePath?: string;
}
