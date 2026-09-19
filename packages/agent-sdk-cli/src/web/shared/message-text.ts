import type { ContentPart, Message } from '@ddlqhd/agent-sdk';

export type ChatHistoryItem =
  | { role: 'user' | 'assistant'; text: string }
  | {
      role: 'tool';
      id: string;
      name: string;
      status: 'result' | 'error';
      arguments?: unknown;
      result?: string;
    };

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

/** Serialize active messages for chat UI (skips system; includes tool calls). */
export function messagesToChatHistory(messages: Message[]): ChatHistoryItem[] {
  const out: ChatHistoryItem[] = [];
  const tools = new Map<string, Extract<ChatHistoryItem, { role: 'tool' }>>();

  function ensureTool(id: string, name?: string): Extract<ChatHistoryItem, { role: 'tool' }> {
    let item = tools.get(id);
    if (!item) {
      item = { role: 'tool', id, name: name?.trim() || id, status: 'result' };
      tools.set(id, item);
      out.push(item);
      return item;
    }
    if (name?.trim() && (item.name === item.id || !item.name)) {
      item.name = name.trim();
    }
    return item;
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = messageText(msg.content).trim();
      if (text) out.push({ role: 'user', text });
      continue;
    }
    if (msg.role === 'assistant') {
      const text = messageText(msg.content).trim();
      if (text) out.push({ role: 'assistant', text });
      for (const tc of msg.toolCalls ?? []) {
        const item = ensureTool(tc.id, tc.name);
        item.arguments = tc.arguments;
      }
      continue;
    }
    if (msg.role === 'tool' && msg.toolCallId) {
      const item = ensureTool(msg.toolCallId, msg.name);
      item.result = typeof msg.content === 'string' ? msg.content : messageText(msg.content);
      item.status = msg.isError === true ? 'error' : 'result';
    }
  }
  return out;
}
