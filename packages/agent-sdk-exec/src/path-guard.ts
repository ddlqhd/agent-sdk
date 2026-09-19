import path from 'node:path';
import { ExecPathError } from './errors.js';

function isInsideRoot(root: string, resolved: string): boolean {
  if (resolved === root) {
    return true;
  }
  const rel = path.relative(root, resolved);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Resolve `targetPath` and, when a workspace root is set, reject paths outside
 * that root and any extra allowed roots (e.g. `{userHome}/.claude/skills`).
 * Extra roots on read include the skill catalog and tool-outputs; write callers
 * must pass only writable extra roots (tool-outputs), never skills.
 */
export function assertWithinRoot(
  workspaceRoot: string | undefined,
  targetPath: string,
  extraRoots: string[] = []
): string {
  const resolved = path.resolve(targetPath);
  if (!workspaceRoot) {
    return resolved;
  }
  const roots = [path.resolve(workspaceRoot), ...extraRoots.map((root) => path.resolve(root))];
  if (roots.some((root) => isInsideRoot(root, resolved))) {
    return resolved;
  }
  throw new ExecPathError(`Path is outside workspace root: ${targetPath}`);
}

/** User-level skill directory on the exec machine. */
export function userSkillsRoot(userHome: string): string {
  return path.join(path.resolve(userHome), '.claude', 'skills');
}

/** Workspace-level skill directory under the exec cwd / jail. */
export function workspaceSkillsRoot(cwd: string): string {
  return path.join(path.resolve(cwd), '.claude', 'skills');
}

/** User-level tool-outputs directory on the exec machine (writable extra root). */
export function userToolOutputsRoot(userHome: string): string {
  return path.join(path.resolve(userHome), '.claude', 'tool-outputs');
}
