import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import type * as acp from '@agentclientprotocol/sdk';
import type { SessionTokenUsage, StreamEvent } from '@ddlqhd/agent-sdk';
import {
  buildToolCallComplete,
  buildToolCallProgress,
  buildToolCallStart,
  makeAcpToolCallId
} from './tool-render.js';

type TodoItem = { content: string; status: string };

const DEFAULT_CONTEXT_SIZE = 200_000;

function resolveContextSize(used: number): number {
  const fromEnv = Number.parseInt(process.env.AGENT_SDK_ACP_CONTEXT_SIZE ?? '', 10);
  const size = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_CONTEXT_SIZE;
  return Math.max(used, size);
}

export class EventBridge {
  private readonly sdkToAcp = new Map<string, string>();
  private readonly toolMeta = new Map<string, { name: string; args: unknown }>();
  private readonly announcedTools = new Set<string>();
  private getSessionUsage?: () => SessionTokenUsage;

  constructor(
    private readonly connection: AgentSideConnection,
    private readonly sessionId: string
  ) {}

  /** Bind Agent session usage after the session Agent is constructed. */
  setSessionUsageProvider(getSessionUsage: () => SessionTokenUsage): void {
    this.getSessionUsage = getSessionUsage;
  }

  private async send(update: acp.SessionUpdate): Promise<void> {
    await this.connection.sessionUpdate({ sessionId: this.sessionId, update });
  }

  private async sendUsageUpdate(used: number): Promise<void> {
    await this.send({
      sessionUpdate: 'usage_update',
      used,
      size: resolveContextSize(used)
    });
  }

  async handleStreamEvent(event: StreamEvent): Promise<void> {
    switch (event.type) {
      case 'text_delta':
        await this.send({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: event.content }
        });
        break;
      case 'thinking':
        await this.send({
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: event.content }
        });
        break;
      case 'tool_call_start': {
        const acpId = makeAcpToolCallId();
        this.sdkToAcp.set(event.id, acpId);
        this.toolMeta.set(event.id, { name: event.name, args: {} });
        this.announcedTools.add(event.id);
        await this.send(buildToolCallStart(event.name, {}, acpId));
        break;
      }
      case 'tool_call_delta': {
        const acpId = this.sdkToAcp.get(event.id);
        const meta = this.toolMeta.get(event.id);
        if (!acpId || !meta) break;
        let parsed: unknown = event.arguments;
        try {
          parsed = JSON.parse(event.arguments);
        } catch {
          parsed = event.arguments;
        }
        meta.args = parsed;
        await this.send(
          buildToolCallProgress(acpId, {
            status: 'in_progress',
            rawInput: parsed
          })
        );
        break;
      }
      case 'tool_call': {
        let acpId = this.sdkToAcp.get(event.id);
        if (!acpId) {
          acpId = makeAcpToolCallId();
          this.sdkToAcp.set(event.id, acpId);
        }
        this.toolMeta.set(event.id, { name: event.name, args: event.arguments });
        if (!this.announcedTools.has(event.id)) {
          this.announcedTools.add(event.id);
          await this.send(buildToolCallStart(event.name, event.arguments, acpId));
        } else {
          await this.send(
            buildToolCallProgress(acpId, {
              status: 'in_progress',
              rawInput: event.arguments
            })
          );
        }
        break;
      }
      case 'tool_result': {
        const acpId = this.sdkToAcp.get(event.toolCallId);
        const meta = this.toolMeta.get(event.toolCallId);
        if (!acpId || !meta) break;
        await this.send(
          buildToolCallComplete(meta.name, meta.args, event.result, acpId, false)
        );
        break;
      }
      case 'tool_error': {
        const acpId = this.sdkToAcp.get(event.toolCallId);
        const meta = this.toolMeta.get(event.toolCallId);
        if (!acpId || !meta) break;
        const msg = event.error?.message ?? 'Tool error';
        await this.send(buildToolCallComplete(meta.name, meta.args, msg, acpId, true));
        break;
      }
      case 'model_usage': {
        if (event.phase === 'output' && event.usage.promptTokens === 0) break;
        if (event.usage.promptTokens <= 0) break;
        await this.sendUsageUpdate(event.usage.promptTokens);
        break;
      }
      case 'session_summary': {
        const used = this.getSessionUsage?.().contextTokens ?? 0;
        await this.sendUsageUpdate(used);
        break;
      }
      case 'context_compressed':
        break;
      default:
        break;
    }
  }

  async emitPlanFromTodos(todos: TodoItem[]): Promise<void> {
    const entries: acp.PlanEntry[] = todos
      .filter((t) => t.content?.trim())
      .map((t) => ({
        content: t.content.trim(),
        priority: 'medium' as const,
        status: (['pending', 'in_progress', 'completed'].includes(t.status)
          ? t.status
          : 'pending') as acp.PlanEntryStatus
      }));

    await this.send({
      sessionUpdate: 'plan',
      entries
    });
  }

  resetTurn(): void {
    this.announcedTools.clear();
    this.sdkToAcp.clear();
    this.toolMeta.clear();
  }
}

export function extractTodosFromToolResult(metadata: unknown): TodoItem[] | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const todos = (metadata as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return null;
  const out: TodoItem[] = [];
  for (const item of todos) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const content = String(rec.content ?? '').trim();
    if (!content) continue;
    out.push({ content, status: String(rec.status ?? 'pending') });
  }
  return out.length ? out : null;
}
