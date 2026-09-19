import path from 'node:path';
import { ExecPathError } from './errors.js';

/**
 * Resolve `targetPath` and, when `workspaceRoot` is set, reject paths outside that root.
 */
export function assertWithinRoot(workspaceRoot: string | undefined, targetPath: string): string {
  const resolved = path.resolve(targetPath);
  if (!workspaceRoot) {
    return resolved;
  }
  const root = path.resolve(workspaceRoot);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ExecPathError(`Path is outside workspace root: ${targetPath}`);
  }
  return resolved;
}
