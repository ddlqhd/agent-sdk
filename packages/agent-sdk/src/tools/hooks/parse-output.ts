import type { HookResult } from './types.js';

function normalizePermissionDecision(
  raw: string | undefined
): 'allow' | 'deny' | 'ask' | 'defer' | null {
  if (!raw || typeof raw !== 'string') return null;
  const x = raw.trim().toLowerCase();
  if (x === 'approve') return 'allow';
  if (x === 'block') return 'deny';
  if (x === 'allow' || x === 'deny' || x === 'ask' || x === 'defer') return x;
  return null;
}

function hookResultFromDecisionObject(obj: Record<string, unknown>): HookResult | null {
  let decision: ReturnType<typeof normalizePermissionDecision> = null;
  let reason: string | undefined;
  let updatedInput: Record<string, unknown> | undefined;

  const hs = obj.hookSpecificOutput;
  if (hs && typeof hs === 'object') {
    const h = hs as Record<string, unknown>;
    decision = normalizePermissionDecision(h.permissionDecision as string | undefined);
    if (typeof h.permissionDecisionReason === 'string') reason = h.permissionDecisionReason;
    if (
      h.updatedInput &&
      typeof h.updatedInput === 'object' &&
      !Array.isArray(h.updatedInput)
    ) {
      updatedInput = h.updatedInput as Record<string, unknown>;
    }
  }

  if (!decision && typeof obj.decision === 'string') {
    decision = normalizePermissionDecision(obj.decision);
    if (!reason && typeof obj.reason === 'string') reason = obj.reason;
  }

  if (!decision) return null;

  if (decision === 'deny') {
    return { allowed: false, reason: reason ?? 'Denied by hook' };
  }
  if (decision === 'ask' || decision === 'defer') {
    return {
      allowed: false,
      reason:
        reason ??
        (decision === 'defer'
          ? 'Tool deferred by hook (SDK has no defer UI)'
          : 'User confirmation required by hook (SDK has no ask UI)')
    };
  }
  return { allowed: true, ...(updatedInput !== undefined ? { updatedInput } : {}) };
}

/**
 * 解析 PreToolUse 命令 Hook 子进程 stdout 中的 JSON（与 Claude Code hookSpecificOutput 对齐）。
 * 先尝试整段 stdout；再自最后一行向前逐行尝试。仅当解析出对象且含有效决策字段时才采纳，避免末行无关 JSON 挡住上一行决策。
 * 无法解析或缺少决策字段时返回 null，由调用方回退到退出码协议。
 */
export function parsePreToolUseCommandOutput(stdout: string): HookResult | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const tried = new Set<string>();

  const tryChunk = (s: string): HookResult | null => {
    if (tried.has(s)) return null;
    let j: unknown;
    try {
      j = JSON.parse(s);
    } catch {
      return null;
    }
    tried.add(s);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    return hookResultFromDecisionObject(j as Record<string, unknown>);
  };

  let r = tryChunk(trimmed);
  if (r !== null) return r;

  const lines = trimmed.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line) continue;
    r = tryChunk(line);
    if (r !== null) return r;
  }

  return null;
}
