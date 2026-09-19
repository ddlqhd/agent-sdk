import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'tui/index': 'src/tui/index.tsx',
    'web/start-server': 'src/web/start-server.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: false,
  treeshake: true,
  outDir: 'dist',
  target: 'es2022',
  platform: 'node',
  external: ['ink', 'react', 'react/jsx-runtime', '@ddlqhd/agent-sdk', '@ddlqhd/agent-sdk-control', '@ddlqhd/agent-sdk-exec', 'undici', 'ws'],
  banner: {
    js: '#!/usr/bin/env node'
  },
  esbuildOptions(options) {
    options.conditions = ['import', 'module', 'require'];
    options.jsx = 'automatic';
  }
});
