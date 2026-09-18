import { resolveSlashCommandName } from '../utils/slash-registry.js';
import type { TuiModal } from './types.js';

export type TuiModalCommand = 'help' | 'status' | 'sessions' | 'checkpoints';

export function parseTuiModalCommand(input: string): TuiModalCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.split(/\s+/);
  const raw = parts[0]!.slice(1);
  const resolved = resolveSlashCommandName(raw);
  if (!resolved) return null;
  if (parts.length > 1) return null;
  if (resolved === 'help' || resolved === 'status' || resolved === 'session' || resolved === 'sessions' || resolved === 'checkpoints') {
    if (resolved === 'session') return 'status';
    return resolved as TuiModalCommand;
  }
  return null;
}

export function tuiModalFromCommand(cmd: TuiModalCommand): TuiModal {
  return cmd;
}
