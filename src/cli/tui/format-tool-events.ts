import { truncate } from '../utils/output.js';

function toolCallIdTag(id: string): string {
  return `[${id}]`;
}

export function formatToolCallText(
  verbose: boolean,
  id: string,
  name: string,
  args: unknown
): string {
  const idPart = ` ${toolCallIdTag(id)}`;
  if (verbose) {
    const argsStr = args != null ? ` ${JSON.stringify(args, null, 2)}` : '';
    return `🔧 ${name}${idPart}${argsStr}`;
  }
  const argsStr = args != null ? `(${truncate(JSON.stringify(args), 80)})` : '()';
  return `🔧 ${name}${argsStr}${idPart}`;
}

export function formatToolResultText(verbose: boolean, id: string, result: string): string {
  const idTag = toolCallIdTag(id);
  if (verbose) {
    return `✓ ${idTag} Result:\n${result}`;
  }
  return `✓ ${idTag} ${truncate(result, 120)}`;
}

export function formatToolErrorText(verbose: boolean, id: string, error: Error): string {
  const idTag = toolCallIdTag(id);
  if (verbose) {
    return `✗ ${idTag} Error:\n${error.message}`;
  }
  return `✗ ${idTag} ${error.message}`;
}
