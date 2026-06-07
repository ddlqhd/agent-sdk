import chalk from 'chalk';
import type { ContentPart, Message } from '../../core/types.js';
import type { ToolLineKind } from '../tui/types.js';
import {
  formatToolCallText,
  toolLineFromPersistedToolMessage
} from '../tui/format-tool-events.js';

export interface TerminalHistoryLine {
  role: string;
  text: string;
  toolKind?: ToolLineKind;
}

export interface ChatHistoryPrintOptions {
  verbose?: boolean;
  clearScreen?: boolean;
}

function formatMessageContent(content: Message['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function partsToText(parts: ContentPart[]): string {
  return parts
    .map((p) => {
      if (p.type === 'text') return p.text;
      if (p.type === 'thinking') return p.thinking;
      if (p.type === 'image') return `[image: ${p.imageUrl}]`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function partsToTerminalLines(parts: ContentPart[]): TerminalHistoryLine[] {
  const lines: TerminalHistoryLine[] = [];
  for (const p of parts) {
    if (p.type === 'thinking') {
      const trimmed = p.thinking.trim();
      if (trimmed) lines.push({ role: 'thinking', text: trimmed });
    } else if (p.type === 'text') {
      const trimmed = p.text.trim();
      if (trimmed) lines.push({ role: 'assistant', text: trimmed });
    } else if (p.type === 'image') {
      lines.push({ role: 'assistant', text: `[image: ${p.imageUrl}]` });
    }
  }
  return lines;
}

export interface MessagesToTerminalLinesOptions {
  verbose?: boolean;
  /** TUI: show tool call/result lines even when verbose is false */
  toolTrace?: boolean;
}

/** Serialize active messages for terminal replay. */
export function messagesToTerminalLines(
  messages: Message[],
  options: MessagesToTerminalLinesOptions = {}
): TerminalHistoryLine[] {
  const verbose = options.verbose === true;
  const toolTrace = options.toolTrace === true;
  const lines: TerminalHistoryLine[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      const text = typeof msg.content === 'string' ? msg.content : partsToText(msg.content);
      const trimmed = text.trim();
      if (trimmed) lines.push({ role: 'user', text: trimmed });
      continue;
    }

    if (msg.role === 'assistant') {
      if (Array.isArray(msg.content)) {
        lines.push(...partsToTerminalLines(msg.content));
      } else {
        const trimmed = msg.content.trim();
        if (trimmed) lines.push({ role: 'assistant', text: trimmed });
      }
      if (msg.toolCalls?.length && (verbose || toolTrace)) {
        for (const tc of msg.toolCalls) {
          lines.push(
            toolTrace
              ? {
                  role: 'tool',
                  text: formatToolCallText(verbose, tc.name, tc.arguments),
                  toolKind: 'call' as const
                }
              : {
                  role: 'tool',
                  text: `${tc.name}(${JSON.stringify(tc.arguments)})`
                }
          );
        }
      }
      continue;
    }

    if (msg.role === 'tool' && (verbose || toolTrace)) {
      const content = formatMessageContent(msg.content);
      if (toolTrace) {
        const line = toolLineFromPersistedToolMessage(verbose, content);
        lines.push({ role: 'tool', text: line.text, toolKind: line.toolKind });
      } else {
        lines.push({ role: 'tool', text: content });
      }
    }
  }

  return lines;
}

function roleLabel(role: string): string {
  if (role === 'user') return chalk.green('You');
  if (role === 'assistant') return chalk.blue('Assistant');
  if (role === 'tool') return chalk.yellow('Tool');
  return chalk.gray(role);
}

export function printTerminalChatHistory(
  lines: TerminalHistoryLine[],
  options: ChatHistoryPrintOptions = {}
): void {
  const isTty = process.stdout.isTTY === true;
  if (options.clearScreen !== false) {
    if (isTty) {
      console.clear();
    } else {
      console.log('\n--- history ---');
    }
  }

  for (const line of lines) {
    console.log(`${roleLabel(line.role)}: ${line.text}\n`);
  }
}

export async function replayAgentHistory(
  agent: import('../../core/agent.js').Agent,
  options: { verbose?: boolean; clearScreen?: boolean } = {}
): Promise<void> {
  const messages = await agent.getSessionManager().loadActiveMessages();
  const lines = messagesToTerminalLines(messages, { verbose: options.verbose });
  printTerminalChatHistory(lines, { clearScreen: options.clearScreen });
}
