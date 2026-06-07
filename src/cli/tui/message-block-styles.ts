import type { ChatLine } from './types.js';

export type MessageBorderColor = 'gray' | 'cyan' | 'yellow' | 'green' | 'red';

export function borderColorForLine(line: Pick<ChatLine, 'role' | 'toolKind'>): MessageBorderColor {
  if (line.role === 'user') return 'gray';
  if (line.role === 'assistant') return 'cyan';
  if (line.role === 'thinking') return 'gray';
  if (line.role === 'tool') {
    if (line.toolKind === 'call') return 'yellow';
    if (line.toolKind === 'result') return 'green';
    if (line.toolKind === 'error') return 'red';
    return 'yellow';
  }
  return 'gray';
}

export function isDimLine(line: Pick<ChatLine, 'role' | 'toolKind'>): boolean {
  return line.role === 'thinking' || (line.role === 'tool' && line.toolKind === 'result');
}

export function displayTextForLine(line: Pick<ChatLine, 'role' | 'toolKind' | 'text'>): string {
  if (line.role === 'tool' && line.toolKind === 'result' && !line.text.startsWith('Result:')) {
    return `Result: ${line.text}`;
  }
  return line.text;
}
