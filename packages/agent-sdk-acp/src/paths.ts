import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function ensureSdkBuilt(): void {
  const candidates: string[] = [];

  try {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve('@ddlqhd/agent-sdk');
    candidates.push(join(dirname(resolved), 'index.js'));
  } catch {
    // package not resolvable from this context
  }

  candidates.push(join(PKG_ROOT, 'node_modules', '@ddlqhd', 'agent-sdk', 'dist', 'index.js'));
  candidates.push(join(PKG_ROOT, '..', '..', 'dist', 'index.js'));

  if (candidates.some((p) => existsSync(p))) {
    return;
  }

  throw new Error(
    '@ddlqhd/agent-sdk is not built or not installed.\n' +
      '  Monorepo: pnpm install && pnpm build from repository root\n' +
      '  Published: npm install @ddlqhd/agent-sdk @ddlqhd/agent-sdk-acp'
  );
}
