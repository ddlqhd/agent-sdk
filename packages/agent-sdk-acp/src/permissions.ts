import { resolve, isAbsolute } from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import {
  buildEditPermissionToolCall,
  buildEditProposal,
  readExistingFileText,
  resolveNewTextForEdit,
  shouldAutoApproveEdit,
  type EditApprovalMode
} from './edit-approval.js';
import { buildToolCallStart, getToolKind } from './tool-render.js';

/** Tools auto-approved when `allowedTools` is configured. */
export const AUTO_APPROVED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'BashOutput',
  'BashList',
  'TodoWrite',
  'Skill',
  'WebFetch',
  'WebSearch'
] as const;

const PERMISSION_TOOLS = new Set(['Bash', 'BashKill', 'Write', 'Edit', 'Agent', 'AskUserQuestion']);

export function needsExplicitApproval(toolName: string): boolean {
  if (PERMISSION_TOOLS.has(toolName)) return true;
  if (toolName.startsWith('mcp__')) return true;
  return false;
}

export function buildPermissionOptions(allowPermanent = true): acp.PermissionOption[] {
  const options: acp.PermissionOption[] = [
    { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
    { optionId: 'allow_session', kind: 'allow_always', name: 'Allow for session' }
  ];
  if (allowPermanent) {
    options.push({ optionId: 'allow_always', kind: 'allow_always', name: 'Allow always' });
  }
  options.push({ optionId: 'deny', kind: 'reject_once', name: 'Deny' });
  options.push({ optionId: 'deny_always', kind: 'reject_always', name: 'Deny always' });
  return options;
}

let permissionSeq = 0;

function nextPermId(sessionId: string): string {
  permissionSeq += 1;
  return `perm-${sessionId.slice(0, 8)}-${permissionSeq}`;
}

export interface PermissionContext {
  sessionId: string;
  cwd: string;
  editMode: EditApprovalMode;
  connection: AgentSideConnection;
  sessionGrants: Set<string>;
  permanentGrants: Set<string>;
  permanentDenies: Set<string>;
  promptSignal?: AbortSignal;
}

export function createPermissionContext(
  sessionId: string,
  cwd: string,
  editMode: EditApprovalMode,
  connection: AgentSideConnection
): PermissionContext {
  return {
    sessionId,
    cwd,
    editMode,
    connection,
    sessionGrants: new Set(),
    permanentGrants: new Set(),
    permanentDenies: new Set()
  };
}

export async function requestToolPermission(
  ctx: PermissionContext,
  toolName: string,
  input: Record<string, unknown>
): Promise<boolean> {
  if (ctx.permanentDenies.has(toolName)) {
    return false;
  }
  if (ctx.permanentGrants.has(toolName) || ctx.sessionGrants.has(toolName)) {
    return true;
  }

  if (toolName === 'Write' || toolName === 'Edit') {
    const proposal = buildEditProposal(toolName, input);
    if (!proposal) return false;
    const abs = isAbsolute(proposal.path) ? proposal.path : resolve(ctx.cwd, proposal.path);
    if (shouldAutoApproveEdit(abs, ctx.editMode, ctx.cwd)) {
      return true;
    }
    const existing = await readExistingFileText(abs);
    const newText = await resolveNewTextForEdit(proposal, ctx.cwd);
    const permId = nextPermId(ctx.sessionId);
    const response = await ctx.connection.requestPermission({
      sessionId: ctx.sessionId,
      toolCall: buildEditPermissionToolCall(
        { ...proposal, oldText: existing, newText },
        ctx.cwd,
        permId
      ),
      options: [
        { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
        { optionId: 'deny', kind: 'reject_once', name: 'Deny' }
      ]
    });
    return interpretPermissionOutcome(response, ctx, toolName, false);
  }

  const permId = nextPermId(ctx.sessionId);
  const title =
    toolName === 'Bash'
      ? `Bash: ${String(input.command ?? '').slice(0, 80)}`
      : toolName;

  const response = await ctx.connection.requestPermission({
    sessionId: ctx.sessionId,
    toolCall: {
      toolCallId: permId,
      title,
      kind: getToolKind(toolName),
      status: 'pending',
      rawInput: input,
      locations: buildToolCallStart(toolName, input, permId).locations
    },
    options: buildPermissionOptions()
  });

  return interpretPermissionOutcome(response, ctx, toolName, true);
}

function interpretPermissionOutcome(
  response: acp.RequestPermissionResponse,
  ctx: PermissionContext,
  toolName: string,
  allowSession: boolean
): boolean {
  const outcome = response.outcome;
  if ('outcome' in outcome && outcome.outcome === 'cancelled') {
    return false;
  }
  if (!('optionId' in outcome)) {
    return false;
  }
  switch (outcome.optionId) {
    case 'allow_once':
      return true;
    case 'allow_session':
      if (allowSession) ctx.sessionGrants.add(toolName);
      return true;
    case 'allow_always':
      ctx.permanentGrants.add(toolName);
      return true;
    case 'deny':
      return false;
    case 'deny_always':
      ctx.permanentDenies.add(toolName);
      return false;
    default:
      return false;
  }
}

export function createCanUseTool(ctx: PermissionContext) {
  return async (toolName: string, input: Record<string, unknown>): Promise<boolean> => {
    if (ctx.promptSignal?.aborted) {
      return false;
    }
    if (!needsExplicitApproval(toolName)) {
      return true;
    }
    try {
      return await requestToolPermission(ctx, toolName, input);
    } catch {
      return false;
    }
  };
}
