import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

const root = dirname(fileURLToPath(import.meta.url));
const isWin = platform() === 'win32';

export default defineConfig({
  root: resolve(root, 'client'),
  publicDir: 'public',
  build: {
    outDir: resolve(root, '../../dist/web-client'),
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    watch: {
      ...(isWin ? { usePolling: true, interval: 300 } : {})
    },
    fs: {
      allow: [root]
    }
  }
});
