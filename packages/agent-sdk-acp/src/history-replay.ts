import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import type { ContentPart, Message } from '@ddlqhd/agent-sdk';

function messageText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((p) => {
      if (p.type === 'text') return p.text;
      if (p.type === 'thinking') return p.thinking;
      if (p.type === 'image') return `[image: ${p.imageUrl}]`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export async function replaySessionHistory(
  connection: AgentSideConnection,
  sessionId: string,
  messages: Message[]
): Promise<void> {
  for (const msg of messages) {
    const text = messageText(msg.content).trim();
    if (!text) continue;

    if (msg.role === 'user') {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text }
        }
      });
    } else if (msg.role === 'assistant') {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text }
        }
      });
    }
    // tool role messages are omitted from replay (results are in assistant turns)
  }
}
