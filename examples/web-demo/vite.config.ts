import { defineConfig } from 'vite';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(root, 'client'),
  publicDir: 'public',
  build: {
    outDir: resolve(root, 'client/dist'),
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    fs: {
      allow: [root, resolve(root, '..')]
    },
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:3001',
        ws: true,
        changeOrigin: true
      }
    }
  }
});
