import { SessionManager } from '../../storage/session.js';
import { getSessionStoragePath } from '../../storage/session-path.js';
import type { Message } from '../../core/types.js';

export function createCliSessionManager(userBasePath?: string): SessionManager {
  return new SessionManager({
    type: 'jsonl',
    basePath: getSessionStoragePath(userBasePath)
  });
}

export interface SessionPickerItem {
  id: string;
  messageCount: number;
  activeCount?: number;
  updatedAt: number;
  preview?: string;
}

function messagePreview(content: Message['content']): string {
  if (typeof content === 'string') {
    return content.replace(/\s+/g, ' ').trim().slice(0, 60);
  }
  return '';
}

export async function listSessionsForPicker(
  userBasePath?: string,
  limit = 20,
  withActive = false
): Promise<SessionPickerItem[]> {
  const manager = createCliSessionManager(userBasePath);
  const sessions = await manager.listSessions();
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);

  const items: SessionPickerItem[] = [];
  for (const s of sorted) {
    let activeCount: number | undefined;
    let preview: string | undefined;
    try {
      await manager.attachSession(s.id);
      const messages = await manager.loadActiveMessages();
      if (withActive) activeCount = messages.length;
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUser) {
        preview = messagePreview(lastUser.content);
      }
    } catch {
      if (withActive) activeCount = 0;
    }
    items.push({
      id: s.id,
      messageCount: s.messageCount,
      activeCount,
      updatedAt: s.updatedAt,
      preview
    });
  }
  return items;
}
