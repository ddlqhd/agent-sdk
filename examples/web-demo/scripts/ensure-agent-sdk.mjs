import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const distJs = join(root, '..', 'node_modules', 'agent-sdk', 'dist', 'index.js');
if (!existsSync(distJs)) {
  console.error(
    '[web-demo] 未找到 agent-sdk 构建产物：\n' +
      `  期望路径: ${distJs}\n` +
      '  请在仓库根目录执行: pnpm install && pnpm build\n' +
      '  然后在 examples/web-demo 执行: pnpm install --ignore-workspace'
  );
  process.exit(1);
}
