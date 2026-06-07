import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';

export type EditApprovalMode = 'default' | 'accept_edits' | 'dont_ask';

const SENSITIVE_NAMES = new Set(['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519']);

export interface EditProposal {
  toolName: string;
  path: string;
  oldText: string | null;
  newText: string;
  arguments: Record<string, unknown>;
}

function asRecord(args: unknown): Record<string, unknown> {
  if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

export function buildEditProposal(toolName: string, input: Record<string, unknown>): EditProposal | null {
  const filePath = input.file_path;
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return null;
  }

  if (toolName === 'Write') {
    const content = String(input.content ?? '');
    return {
      toolName,
      path: filePath,
      oldText: null,
      newText: content,
      arguments: input
    };
  }

  if (toolName === 'Edit') {
    const oldString = String(input.old_string ?? '');
    const newString = String(input.new_string ?? '');
    const replaceAll = Boolean(input.replace_all);
    return {
      toolName,
      path: filePath,
      oldText: oldString,
      newText: newString,
      arguments: { ...input, replace_all: replaceAll }
    };
  }

  return null;
}

export async function resolveNewTextForEdit(
  proposal: EditProposal,
  projectDir: string
): Promise<string> {
  if (proposal.toolName === 'Write') {
    return proposal.newText;
  }
  const abs = isAbsolute(proposal.path) ? proposal.path : resolve(projectDir, proposal.path);
  let current = '';
  try {
    current = await readFile(abs, 'utf-8');
  } catch {
    current = '';
  }
  const oldString = proposal.oldText ?? '';
  const replaceAll = Boolean(proposal.arguments.replace_all);
  if (!replaceAll) {
    const idx = current.indexOf(oldString);
    if (idx === -1) return current;
    return current.slice(0, idx) + proposal.newText + current.slice(idx + oldString.length);
  }
  return current.split(oldString).join(proposal.newText);
}

export async function readExistingFileText(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, 'utf-8');
  } catch {
    return null;
  }
}

/** True when `targetPath` resolves inside `directoryPath` (not a prefix collision). */
export function isPathInsideDirectory(targetPath: string, directoryPath: string): boolean {
  const normalizedDir = resolve(directoryPath);
  const normalizedTarget = resolve(targetPath);
  if (normalizedTarget === normalizedDir) {
    return true;
  }
  const rel = relative(normalizedDir, normalizedTarget);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export function shouldAutoApproveEdit(
  absPath: string,
  mode: EditApprovalMode,
  projectDir: string
): boolean {
  const base = absPath.split(/[/\\]/).pop() ?? '';
  if (SENSITIVE_NAMES.has(base)) {
    return false;
  }
  if (mode === 'default') {
    return false;
  }
  if (mode === 'dont_ask') {
    return true;
  }
  // accept_edits: workspace + temp
  if (isPathInsideDirectory(absPath, projectDir)) {
    return true;
  }
  const tmp = process.env.TEMP || process.env.TMP || '/tmp';
  if (isPathInsideDirectory(absPath, tmp)) {
    return true;
  }
  if (sep === '\\' && resolve(absPath).toLowerCase().includes('\\temp\\')) {
    return true;
  }
  return false;
}

export function buildEditPermissionToolCall(
  proposal: EditProposal,
  projectDir: string,
  permId: string
): acp.ToolCallUpdate {
  const abs = isAbsolute(proposal.path) ? proposal.path : resolve(projectDir, proposal.path);
  return {
    toolCallId: permId,
    title: `${proposal.toolName}: ${abs}`,
    kind: 'edit',
    status: 'pending',
    locations: [{ path: abs }],
    rawInput: proposal.arguments,
    content: [
      {
        type: 'diff',
        path: abs,
        oldText: proposal.oldText,
        newText: proposal.newText
      }
    ]
  };
}

export function mapEditModeId(modeId: string): EditApprovalMode {
  switch (modeId) {
    case 'accept_edits':
      return 'accept_edits';
    case 'dont_ask':
      return 'dont_ask';
    default:
      return 'default';
  }
}
