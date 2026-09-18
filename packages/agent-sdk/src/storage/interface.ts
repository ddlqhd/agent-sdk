import type { StorageAdapter, StorageConfig } from '../core/types.js';
import { JsonlStorage } from './jsonl.js';
import { MemoryStorage } from './memory.js';

/**
 * 存储工厂函数
 */
export function createStorage(config?: StorageConfig & { basePath?: string }): StorageAdapter {
  switch (config?.type) {
    case 'memory':
      return new MemoryStorage();
    case 'jsonl':
    default:
      return new JsonlStorage({ basePath: config?.basePath });
  }
}

// 重新导出具体实现
export { JsonlStorage, createJsonlStorage } from './jsonl.js';
export { MemoryStorage, createMemoryStorage } from './memory.js';
export { SessionManager, reconstructActiveMessages, messageToSessionEntry, buildSummaryEntry } from './session.js';
