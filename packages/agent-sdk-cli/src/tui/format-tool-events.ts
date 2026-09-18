import { truncate } from '../utils/output.js';
import type { ToolLineKind } from './types.js';

/** Extract a short argument summary for OpenCode-style `Name: value` display. */
export function summarizeToolArgs(name: string, args: unknown): string {
  if (args == null || typeof args !== 'object') {
    return args != null ? truncate(String(args), 80) : '';
  }
  const record = args as Record<string, unknown>;
  const keyByTool: Record<string, string> = {
    Read: 'file_path',
    Write: 'file_path',
    Edit: 'file_path',
    Grep: 'pattern',
    Bash: 'command',
    WebFetch: 'url'
  };
  const preferred = keyByTool[name];
  const keys = preferred ? [preferred, 'file_path', 'path'] : ['file_path', 'path'];
  for (const k of keys) {
    if (k in record) {
      const val = record[k];
      return truncate(typeof val === 'string' ? val : JSON.stringify(val), 80);
    }
  }
  return truncate(JSON.stringify(args), 80);
}

export function formatToolCallText(verbose: boolean, name: string, args: unknown): string {
  if (verbose) {
    const argsStr = args != null ? `\n${JSON.stringify(args, null, 2)}` : '';
    return `${name}:${argsStr}`;
  }
  const summary = summarizeToolArgs(name, args);
  return summary ? `${name}: ${summary}` : `${name}:`;
}

export function formatToolResultText(verbose: boolean, result: string): string {
  if (verbose) return result;
  return truncate(result, 120);
}

export function formatToolErrorText(verbose: boolean, error: Error): string {
  if (verbose) return `Error:\n${error.message}`;
  return `Error: ${error.message}`;
}

export function toolLineFromCall(
  verbose: boolean,
  name: string,
  args: unknown
): { role: 'tool'; text: string; toolKind: ToolLineKind } {
  return {
    role: 'tool',
    text: formatToolCallText(verbose, name, args),
    toolKind: 'call'
  };
}

export function toolLineFromResult(
  verbose: boolean,
  result: string
): { role: 'tool'; text: string; toolKind: ToolLineKind } {
  return {
    role: 'tool',
    text: formatToolResultText(verbose, result),
    toolKind: 'result'
  };
}

export function toolLineFromError(
  verbose: boolean,
  error: Error
): { role: 'tool'; text: string; toolKind: ToolLineKind } {
  return {
    role: 'tool',
    text: formatToolErrorText(verbose, error),
    toolKind: 'error'
  };
}

/** Agent persists failed tool output as `Error: <message>`. */
export function isPersistedToolErrorContent(content: string): boolean {
  return content.startsWith('Error: ');
}

export function toolLineFromPersistedToolMessage(
  verbose: boolean,
  content: string
): { role: 'tool'; text: string; toolKind: ToolLineKind } {
  if (isPersistedToolErrorContent(content)) {
    const message = content.slice('Error: '.length);
    return toolLineFromError(verbose, new Error(message));
  }
  return toolLineFromResult(verbose, content);
}
