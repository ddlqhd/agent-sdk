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
