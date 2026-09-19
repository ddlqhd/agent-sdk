import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@ddlqhd/agent-sdk/workflow': resolve(root, 'packages/agent-sdk/src/workflow/index.ts'),
      '@ddlqhd/agent-sdk/models': resolve(root, 'packages/agent-sdk/src/models/index.ts'),
      '@ddlqhd/agent-sdk/tools': resolve(root, 'packages/agent-sdk/src/tools/index.ts'),
      '@ddlqhd/agent-sdk': resolve(root, 'packages/agent-sdk/src/index.ts'),
      '@ddlqhd/agent-sdk-exec': resolve(root, 'packages/agent-sdk-exec/src/index.ts')
    },
    dedupe: ['@modelcontextprotocol/sdk', 'commander', 'iconv-lite', 'chalk']
  },
  test: {
    deps: {
      moduleDirectories: [
        'node_modules',
        'packages/agent-sdk/node_modules',
        'packages/agent-sdk-cli/node_modules',
        'packages/agent-sdk-acp/node_modules',
        'packages/agent-sdk-exec/node_modules'
      ]
    },
    globals: true,
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['packages/agent-sdk/src/**/*.ts'],
      exclude: ['packages/agent-sdk-cli/**']
    }
  }
});
