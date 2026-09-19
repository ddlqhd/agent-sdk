import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  outDir: 'dist',
  target: 'es2022',
  platform: 'node',
  external: ['@ddlqhd/agent-sdk'],
  esbuildOptions(options) {
    options.conditions = ['import', 'module', 'require'];
  }
});
