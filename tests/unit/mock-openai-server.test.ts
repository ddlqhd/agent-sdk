import { afterEach, describe, expect, it } from 'vitest';
import {
  MOCK_ASSISTANT_TEXT,
  MOCK_TOOL_DONE_MARKER,
  decideMockReply,
  inferToolKind,
  startMockOpenAIServer
} from '../helpers/mock-openai-server.js';

describe('mock OpenAI tool-call script', () => {
  it('infers side-effect-free tool kinds from the user prompt', () => {
    expect(inferToolKind('List files with Glob')).toBe('glob-ls');
    expect(inferToolKind('Print working directory with pwd')).toBe('bash-pwd');
    expect(inferToolKind('Run ls in the workspace')).toBe('bash-ls');
    expect(inferToolKind('Reply with the mock marker only.')).toBeUndefined();
  });

  it('emits a tool call first, then a final answer after the tool result', () => {
    const first = decideMockReply({
      messages: [{ role: 'user', content: 'List files with Glob' }]
    });
    expect(first).toEqual({ reply: 'tool', text: '', toolKind: 'glob-ls' });

    const second = decideMockReply({
      messages: [
        { role: 'user', content: 'List files with Glob' },
        { role: 'assistant', content: null },
        { role: 'tool', content: '/tmp/probe-ls.txt' }
      ]
    });
    expect(second.reply).toBe('text');
    expect(second.text).toContain(MOCK_ASSISTANT_TEXT);
    expect(second.text).toContain(MOCK_TOOL_DONE_MARKER);
    expect(second.text).toContain('probe-ls.txt');
  });
});

describe('mock OpenAI HTTP tool-call SSE', () => {
  let mock: Awaited<ReturnType<typeof startMockOpenAIServer>> | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('streams tool_calls then a text completion after the tool role', async () => {
    mock = await startMockOpenAIServer();
    const first = await fetch(`${mock.url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: 'user', content: 'Print working directory with pwd' }],
        tools: [{ type: 'function', function: { name: 'Bash' } }]
      })
    });
    expect(first.ok).toBe(true);
    const firstBody = await first.text();
    expect(firstBody).toContain('"finish_reason":"tool_calls"');
    expect(firstBody).toContain('"name":"Bash"');
    expect(firstBody).toContain('pwd');

    const second = await fetch(`${mock.url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stream: true,
        messages: [
          { role: 'user', content: 'Print working directory with pwd' },
          { role: 'tool', content: '/tmp/control-host-cwd' }
        ]
      })
    });
    expect(second.ok).toBe(true);
    const secondBody = await second.text();
    expect(secondBody).toContain(MOCK_ASSISTANT_TEXT);
    expect(secondBody).toContain(MOCK_TOOL_DONE_MARKER);
    expect(secondBody).toContain('control-host-cwd');
    expect(mock.requests.map((r) => r.reply)).toEqual(['tool', 'text']);
  });
});
