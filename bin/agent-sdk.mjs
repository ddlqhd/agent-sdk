#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distEntry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli', 'index.js');

if (!existsSync(distEntry)) {
  console.error(
    '[agent-sdk] CLI 未构建。\n' +
      `  期望: ${distEntry}\n` +
      '  请执行: pnpm install && pnpm build\n' +
      '  然后: pnpm cli --help'
  );
  process.exit(1);
}

await import(distEntry);
