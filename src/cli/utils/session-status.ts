import type { Agent } from '../../core/agent.js';
import type { Message, SessionTokenUsage } from '../../core/types.js';
import { ensureChatSessionAttached } from './agent-bootstrap.js';

export interface SessionStatusSnapshot {
  sessionId?: string;
  modelName: string;
  activeMessageCount: number;
  checkpointCount: number;
  usage: SessionTokenUsage;
  context: ReturnType<Agent['getContextStatus']>;
  lastUserPreview?: string;
  lastAssistantPreview?: string;
  verbose: boolean;
  streaming: boolean;
  cwd: string;
}

function previewText(content: Message['content']): string {
  if (typeof content === 'string') return content.replace(/\s+/g, ' ').trim().slice(0, 80);
  return '';
}

export async function collectSessionStatus(
  agent: Agent,
  opts: { sessionId?: string; verbose: boolean; streaming: boolean; cwd: string }
): Promise<SessionStatusSnapshot> {
  const sm = agent.getSessionManager();
  const sid = opts.sessionId ?? sm.sessionId ?? undefined;
  const model = agent.getModel();
  let activeCount = 0;
  let checkpoints = 0;
  let lastUser = '';
  let lastAssistant = '';

  if (sid) {
    try {
      await ensureChatSessionAttached(agent, sid);
      const messages = await sm.loadActiveMessages();
      activeCount = messages.length;
      const cps = await agent.listSessionCheckpoints();
      checkpoints = cps.length;
      const u = [...messages].reverse().find((m) => m.role === 'user');
      const a = [...messages].reverse().find((m) => m.role === 'assistant');
      if (u) lastUser = previewText(u.content);
      if (a) lastAssistant = previewText(a.content);
    } catch {
      activeCount = agent.getActiveMessageCount();
    }
  }

  return {
    sessionId: sid,
    modelName: model.name,
    activeMessageCount: activeCount,
    checkpointCount: checkpoints,
    usage: agent.getSessionUsage(),
    context: agent.getContextStatus(),
    lastUserPreview: lastUser || undefined,
    lastAssistantPreview: lastAssistant || undefined,
    verbose: opts.verbose,
    streaming: opts.streaming,
    cwd: opts.cwd
  };
}
