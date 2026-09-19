#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distEntry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

if (!existsSync(distEntry)) {
  console.error(
    '[agent-sdk-exec] 未构建。\n' +
      `  期望: ${distEntry}\n` +
      '  请执行: pnpm install && pnpm build'
  );
  process.exit(1);
}

await import(distEntry);
