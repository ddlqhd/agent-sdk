import { describe, it, expect, vi, afterEach } from 'vitest';
import { messagesToTerminalLines, printTerminalChatHistory } from '../../src/cli/utils/chat-history.js';
import type { Message } from '../../src/core/types.js';

describe('messagesToTerminalLines', () => {
  it('keeps user and assistant text only when not verbose', () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'tool', content: 'ignored', toolCallId: 't1' }
    ];
    const lines = messagesToTerminalLines(messages);
    expect(lines).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi' }
    ]);
  });

  it('splits assistant thinking parts into separate lines', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'reasoning here' },
          { type: 'text', text: 'answer' }
        ]
      }
    ];
    const lines = messagesToTerminalLines(messages);
    expect(lines).toEqual([
      { role: 'thinking', text: 'reasoning here' },
      { role: 'assistant', text: 'answer' }
    ]);
  });

  it('replays persisted tool errors with toolKind error', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'ok',
        toolCalls: [{ id: 'tc1', name: 'Read', arguments: { path: '/missing' } }]
      },
      { role: 'tool', content: 'Error: file missing', toolCallId: 'tc1' }
    ];
    const lines = messagesToTerminalLines(messages, { toolTrace: true });
    expect(lines.some((l) => l.role === 'tool' && l.toolKind === 'error' && l.text === 'Error: file missing')).toBe(
      true
    );
  });

  it('includes formatted tool trace when toolTrace is true without verbose', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'ok',
        toolCalls: [{ id: 'tc1', name: 'Read', arguments: { path: '/a' } }]
      },
      { role: 'tool', content: 'file body', toolCallId: 'tc1' }
    ];
    const lines = messagesToTerminalLines(messages, { toolTrace: true });
    expect(lines.some((l) => l.role === 'tool' && l.toolKind === 'call' && l.text === 'Read: /a')).toBe(
      true
    );
    expect(lines.some((l) => l.role === 'tool' && l.toolKind === 'result' && l.text === 'file body')).toBe(
      true
    );
  });

  it('includes tool rows when verbose', () => {
    const messages: Message[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: 'ok',
        toolCalls: [{ id: 'tc1', name: 'Read', arguments: { path: '/a' } }]
      },
      { role: 'tool', content: 'file body', toolCallId: 'tc1' }
    ];
    const lines = messagesToTerminalLines(messages, { verbose: true });
    expect(lines.some((l) => l.role === 'tool' && l.text.includes('Read'))).toBe(true);
    expect(lines.some((l) => l.text === 'file body')).toBe(true);
  });
});

describe('printTerminalChatHistory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses separator instead of clear when not a TTY', () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '));
    });
    const clearSpy = vi.spyOn(console, 'clear').mockImplementation(() => {});

    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    printTerminalChatHistory([{ role: 'user', text: 'hi' }]);

    expect(clearSpy).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes('--- history ---'))).toBe(true);
    expect(logs.some((l) => l.includes('hi'))).toBe(true);
    spy.mockRestore();
    clearSpy.mockRestore();
  });
});
