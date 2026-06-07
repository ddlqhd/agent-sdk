import chalk from 'chalk';
import type { ContentPart, Message } from '../../core/types.js';

export interface TerminalHistoryLine {
  role: string;
  text: string;
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

/** Serialize active messages for terminal replay. */
export function messagesToTerminalLines(
  messages: Message[],
  options: { verbose?: boolean } = {}
): TerminalHistoryLine[] {
  const verbose = options.verbose === true;
  const lines: TerminalHistoryLine[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user' || msg.role === 'assistant') {
      const text =
        typeof msg.content === 'string' ? msg.content : partsToText(msg.content);
      const trimmed = text.trim();
      if (trimmed) {
        lines.push({ role: msg.role, text: trimmed });
      }
      if (verbose && msg.role === 'assistant' && msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          lines.push({
            role: 'tool',
            text: `${tc.name}(${JSON.stringify(tc.arguments)})`
          });
        }
      }
      continue;
    }

    if (msg.role === 'tool' && verbose) {
      lines.push({
        role: 'tool',
        text: formatMessageContent(msg.content)
      });
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
