/**
 * Claude Code 风格：简单 matcher 为精确工具名（或 a|b，可含 `-`）；含其它元字符时为 JS 正则源码。
 */
const SIMPLE_EXACT_MATCHER = /^[A-Za-z0-9_|\-]+$/;

export function matchTool(toolName: string, matcher?: string): boolean {
  if (!matcher || matcher === '' || matcher === '*') return true;
  if (SIMPLE_EXACT_MATCHER.test(matcher)) {
    const parts = matcher.split('|').map(p => p.trim()).filter(Boolean);
    return parts.includes(toolName);
  }
  try {
    return new RegExp(matcher).test(toolName);
  } catch {
    return false;
  }
}

function globPatternToRegex(glob: string): RegExp {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (/[.+^${}()|[\]\\]/.test(c)) re += `\\${c}`;
    else re += c;
  }
  re += '$';
  return new RegExp(re);
}

/**
 * 配置文件中的 `if` 字段：`ToolName(glob)`，仅当工具名一致且参数子串匹配时运行该 command hook。
 * 子串优先取 `command`，否则 `file_path`，否则 `path`。格式无法解析时返回 true（不拦截，仍执行 hook）。
 */
export function matchesHookIfClause(
  toolName: string,
  toolInput: Record<string, unknown>,
  ifClause: string | undefined
): boolean {
  if (!ifClause?.trim()) return true;
  const m = ifClause.trim().match(/^([-A-Za-z0-9_]+)\((.*)\)\s*$/);
  if (!m) return true;
  const [, tn, patRaw] = m;
  if (tn !== toolName) return false;
  const pattern = patRaw.trim();
  if (pattern === '' || pattern === '*') return true;

  const cmd = typeof toolInput.command === 'string' ? toolInput.command : '';
  const filePath =
    typeof toolInput.file_path === 'string'
      ? toolInput.file_path
      : typeof toolInput.path === 'string'
        ? toolInput.path
        : '';
  const subject = cmd !== '' ? cmd : filePath;
  if (subject === '') return false;
  try {
    return globPatternToRegex(pattern).test(subject);
  } catch {
    return false;
  }
}
