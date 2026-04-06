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
    outDir: resolve(root, 'client/dist'),
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Windows: 原生 fs 监听常漏事件，导致页面不热更新；轮询更稳。
    // 链接依赖 @ddlqhd/agent-sdk（file:../..）在 node_modules 下，默认被忽略，需显式取消忽略以便 dist 变更触发刷新。
    watch: {
      ...(isWin ? { usePolling: true, interval: 300 } : {}),
      ignored: ['!**/node_modules/@ddlqhd/agent-sdk/**']
    },
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
