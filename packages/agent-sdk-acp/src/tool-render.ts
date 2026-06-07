import { randomUUID } from 'node:crypto';
import type * as acp from '@agentclientprotocol/sdk';

export type ToolKind = acp.ToolKind;

const TOOL_KIND_MAP: Record<string, ToolKind> = {
  Read: 'read',
  Glob: 'read',
  Grep: 'search',
  Write: 'edit',
  Edit: 'edit',
  Bash: 'execute',
  BashOutput: 'execute',
  BashList: 'execute',
  BashKill: 'execute',
  WebFetch: 'fetch',
  WebSearch: 'fetch',
  TodoWrite: 'other',
  Skill: 'read',
  Agent: 'execute',
  AskUserQuestion: 'other'
};

const MAX_RESULT_CHARS = 12_000;

export function getToolKind(toolName: string): ToolKind {
  if (toolName.startsWith('mcp__')) {
    const lower = toolName.toLowerCase();
    if (lower.includes('read') || lower.includes('get')) return 'read';
    if (lower.includes('search') || lower.includes('grep')) return 'search';
    if (lower.includes('write') || lower.includes('edit') || lower.includes('patch')) return 'edit';
    if (lower.includes('fetch') || lower.includes('http')) return 'fetch';
    return 'other';
  }
  return TOOL_KIND_MAP[toolName] ?? 'other';
}

export function makeAcpToolCallId(): string {
  return `tc-${randomUUID().slice(0, 12)}`;
}

export function truncateText(text: string, max = MAX_RESULT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n… (truncated, ${text.length} chars total)`;
}

function asRecord(args: unknown): Record<string, unknown> {
  if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

export function buildToolTitle(toolName: string, args: unknown): string {
  const a = asRecord(args);
  if (toolName === 'Bash') {
    const cmd = String(a.command ?? '');
    return cmd.length > 80 ? `Bash: ${cmd.slice(0, 77)}…` : `Bash: ${cmd}`;
  }
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
    return `${toolName}: ${String(a.file_path ?? '?')}`;
  }
  if (toolName === 'Glob') {
    return `Glob: ${String(a.pattern ?? '?')}`;
  }
  if (toolName === 'Grep') {
    return `Grep: ${String(a.pattern ?? '?')}`;
  }
  if (toolName === 'TodoWrite') {
    return 'Update task plan';
  }
  if (toolName === 'Agent') {
    return `Subagent: ${String(a.subagent_type ?? 'general-purpose')}`;
  }
  return toolName;
}

export function extractToolLocations(
  toolName: string,
  args: unknown
): acp.ToolCallLocation[] | undefined {
  const a = asRecord(args);
  const filePath = a.file_path;
  if (typeof filePath === 'string' && filePath.trim()) {
    return [{ path: filePath }];
  }
  if (toolName === 'Glob' && typeof a.path === 'string' && a.path.trim()) {
    return [{ path: a.path }];
  }
  return undefined;
}

export function buildToolCallStart(
  toolName: string,
  args: unknown,
  toolCallId: string
): acp.ToolCall & { sessionUpdate: 'tool_call' } {
  return {
    sessionUpdate: 'tool_call',
    toolCallId,
    title: buildToolTitle(toolName, args),
    kind: getToolKind(toolName),
    status: 'pending',
    rawInput: args,
    locations: extractToolLocations(toolName, args)
  };
}

export function buildToolCallProgress(
  toolCallId: string,
  patch: Partial<acp.ToolCallUpdate>
): acp.ToolCallUpdate & { sessionUpdate: 'tool_call_update' } {
  return {
    sessionUpdate: 'tool_call_update',
    toolCallId,
    ...patch
  };
}

export function buildToolCallComplete(
  toolName: string,
  args: unknown,
  resultText: string,
  toolCallId: string,
  isError: boolean,
  diff?: { path: string; oldText: string | null; newText: string }
): acp.ToolCallUpdate & { sessionUpdate: 'tool_call_update' } {
  const content: acp.ToolCallContent[] = [];
  if (diff) {
    content.push({
      type: 'diff',
      path: diff.path,
      oldText: diff.oldText,
      newText: diff.newText
    });
  } else {
    content.push({
      type: 'content',
      content: {
        type: 'text',
        text: truncateText(resultText)
      }
    });
  }

  return {
    sessionUpdate: 'tool_call_update',
    toolCallId,
    title: buildToolTitle(toolName, args),
    kind: getToolKind(toolName),
    status: isError ? 'failed' : 'completed',
    content,
    rawOutput: isError ? { error: resultText } : { content: resultText },
    locations: extractToolLocations(toolName, args)
  };
}
