import type { ContentPart, Message } from '@ddlqhd/agent-sdk';

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  text: string;
}

function messageText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((p) => {
      if (p.type === 'text') return p.text;
      if (p.type === 'thinking') return p.thinking;
      if (p.type === 'image') {
        return p.source.type === 'url'
          ? `[image: ${p.source.url}]`
          : `[image: ${p.source.mimeType}]`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export const SESSION_TITLE_MAX = 80;

/**
 * First real user question, collapsed to one line and truncated for session lists.
 * Skips summary / rewind rows so compacted sessions still show the original ask.
 */
export function firstUserQuestionTitle(
  entries: Array<{ role?: string; $type?: string; content?: string | ContentPart[] }>,
  max = SESSION_TITLE_MAX
): string | undefined {
  for (const entry of entries) {
    if (entry.$type === 'summary' || entry.$type === 'rewind') continue;
    if (entry.role !== 'user' || entry.content === undefined) continue;
    const text = messageText(entry.content).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    return text.length <= max ? text : `${text.slice(0, max)}…`;
  }
  return undefined;
}

/** Serialize active messages for chat UI (skips system/tool roles). */
export function messagesToChatHistory(messages: Message[]): ChatHistoryItem[] {
  const out: ChatHistoryItem[] = [];
  for (const msg of messages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const text = messageText(msg.content).trim();
    if (!text) continue;
    out.push({ role: msg.role, text });
  }
  return out;
}
