/**
 * Subagent profile: Claude Code–compatible markdown frontmatter + programmatic config.
 */

export type SubagentProfileSource = 'builtin' | 'file' | 'config';

/**
 * Optional frontmatter/programmatic fields shared with Claude Code–style agent markdown.
 * **`maxTurns`** and **`initialPrompt`** affect subagent runs today; the rest are parsed/stored for compatibility or future runtime wiring.
 */
export interface SubagentReservedFields {
  model?: string;
  permissionMode?: string;
  maxTurns?: number;
  skills?: string[];
  mcpServers?: unknown;
  hooks?: unknown;
  memory?: string;
  background?: boolean;
  /**
   * Prepended to the Agent tool `prompt` for the subagent run as one user message
   * (`initialPrompt` + blank lines + tool prompt).
   */
  initialPrompt?: string;
}

export interface SubagentProfile extends SubagentReservedFields {
  name: string;
  description: string;
  /** Markdown file body after frontmatter — merged into system with builtin fragments and prompts config. */
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
