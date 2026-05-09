import type { SubagentProfile } from './types.js';

export function resolveProfileBuiltinFragment(
  profile: SubagentProfile,
  subagentConfig?: { subagentTypePrompts?: Partial<Record<string, string>> }
): string | undefined {
  const custom = subagentConfig?.subagentTypePrompts?.[profile.name];
  if (custom !== undefined) {
    const trimmed = custom.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  return profile.builtinSystemFragment;
}

/**
 * Build merged system prompt for a subagent run (type fragment + profile body).
 */
export function buildSubagentMergedSystemPrompt(
  profile: SubagentProfile,
  subagentConfig?: { subagentTypePrompts?: Partial<Record<string, string>> }
): string | undefined {
  const typeFragment = resolveProfileBuiltinFragment(profile, subagentConfig);
  const parts = [typeFragment, profile.promptBody].filter(
    (s): s is string => typeof s === 'string' && s.trim().length > 0
  );
  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

const AGENT_TOOL_INTRO = `Launch a new subagent to handle complex, multi-step tasks autonomously.

The Agent tool delegates work to a dedicated subagent that runs in isolated context and returns a final result back to the parent agent.

Use this tool when:
- The task requires broader exploration or multi-step research
- You want to keep the parent context focused and concise
- You need a specific subagent profile (see list below)

When NOT to use this tool:
- Reading a known file path (use Read directly)
- Simple symbol or text lookup (use Grep/Glob directly)
- Small scoped changes in 1-3 files that do not benefit from delegation

Usage notes:
- Always pass a short description and a complete prompt with all required context
- Choose **subagent_type** from the available subagents list below
- Optional **model** passes only the target model id string (e.g. gpt-4o-mini); uses the same built-in provider adapter as the parent (OpenAI / Anthropic / Ollama)
- Tool allowlists, timeouts, and extra system text come from AgentConfig.subagent, profile tools / disallowedTools, and subagentTypePrompts (not from this tool call)
- Subagents do not inherit parent conversation history, only the prompt you provide
- Subagents cannot spawn other subagents (no nested Agent calls)
- **AskUserQuestion** is never included in a subagent tool list

### Available subagents`;

export function buildAgentToolDescription(profiles: SubagentProfile[]): string {
  const lines = profiles.map(p => `- **${p.name}**: ${p.description || '(no description)'}`);
  return `${AGENT_TOOL_INTRO}\n\n${lines.join('\n')}`;
}
