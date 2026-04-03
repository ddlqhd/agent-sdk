import { describe, it, expect } from 'vitest';
import {
  ollamaStreamChunksFromChatData,
  ollamaMessageContentToApiString,
  OllamaAdapter
} from '../../src/models/ollama.js';
import type { ModelParams } from '../../src/core/types.js';

function parseToolArguments(args: unknown): Record<string, unknown> {
  if (args == null) return {};
  if (typeof args === 'object' && !Array.isArray(args)) return args as Record<string, unknown>;
  return {};
}

describe('ollamaStreamChunksFromChatData', () => {
  const nextId = (): string => 'ollama_tc_1';

  it('yields thinking before text when both present in one chunk', () => {
    const chunks = ollamaStreamChunksFromChatData(
      { message: { thinking: 'reason', content: 'answer' } },
      parseToolArguments,
      nextId
    );
    expect(chunks.map((c) => c.type)).toEqual(['thinking', 'text']);
    expect(chunks[0]).toMatchObject({ type: 'thinking', content: 'reason' });
    expect(chunks[1]).toMatchObject({ type: 'text', content: 'answer' });
  });

  it('skips empty thinking string', () => {
    const chunks = ollamaStreamChunksFromChatData(
      { message: { thinking: '', content: 'only' } },
      parseToolArguments,
      nextId
    );
    expect(chunks.map((c) => c.type)).toEqual(['text']);
  });

  it('emits only thinking when no content', () => {
    const chunks = ollamaStreamChunksFromChatData(
      { message: { thinking: 'trace' } },
      parseToolArguments,
      nextId
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'thinking', content: 'trace' });
  });

  it('maps tool_calls after message content', () => {
    const chunks = ollamaStreamChunksFromChatData(
      {
        message: {
          content: 'x',
          tool_calls: [
            {
              function: { name: 'demo', arguments: { a: 1 } }
            }
          ]
        }
      },
      parseToolArguments,
      nextId
    );
    expect(chunks.map((c) => c.type)).toEqual(['text', 'tool_call']);
    expect(chunks[1]).toMatchObject({
      type: 'tool_call',
      toolCall: { name: 'demo', arguments: { a: 1 } }
    });
  });
});

describe('ollamaMessageContentToApiString', () => {
  it('returns plain string unchanged', () => {
    expect(ollamaMessageContentToApiString('hello')).toBe('hello');
  });

  it('keeps only text parts and omits thinking blocks', () => {
    expect(
      ollamaMessageContentToApiString([
        { type: 'thinking', thinking: 'internal trace' },
        { type: 'text', text: '你好！' }
      ])
    ).toBe('你好！');
  });

  it('joins multiple text parts with blank line', () => {
    expect(
      ollamaMessageContentToApiString([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' }
      ])
    ).toBe('a\n\nb');
  });
});

describe('OllamaAdapter transformMessages', () => {
  it('maps assistant array content to a single string for Ollama', () => {
    const adapter = new OllamaAdapter({ model: 'qwen3' });
    const transform = adapter as unknown as {
      transformMessages(m: ModelParams['messages']): unknown[];
    };
    const messages = transform.transformMessages([
      { role: 'user', content: '你好' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '用户用中文打招呼' },
          { type: 'text', text: '你好！有什么我可以帮助你的吗？' }
        ]
      }
    ]);
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: '你好！有什么我可以帮助你的吗？'
    });
  });
});

describe('OllamaAdapter request body', () => {
  it('includes top-level think when configured', () => {
    const adapter = new OllamaAdapter({ think: true, model: 'qwen3' });
    const params: ModelParams = {
      messages: [{ role: 'user', content: 'hi' }]
    };
    const build = adapter as unknown as {
      buildRequestBody(p: ModelParams, stream: boolean): Record<string, unknown>;
    };
    const body = build.buildRequestBody(params, true);
    expect(body.think).toBe(true);
    expect(body.model).toBe('qwen3');
    expect(body.stream).toBe(true);
  });

  it('omits think when not configured', () => {
    const adapter = new OllamaAdapter({ model: 'qwen3' });
    const params: ModelParams = {
      messages: [{ role: 'user', content: 'hi' }]
    };
    const build = adapter as unknown as {
      buildRequestBody(p: ModelParams, stream: boolean): Record<string, unknown>;
    };
    const body = build.buildRequestBody(params, false);
    expect('think' in body).toBe(false);
  });

  it('passes GPT-OSS think level', () => {
    const adapter = new OllamaAdapter({ think: 'medium', model: 'gpt-oss' });
    const params: ModelParams = {
      messages: [{ role: 'user', content: 'hi' }]
    };
    const build = adapter as unknown as {
      buildRequestBody(p: ModelParams, stream: boolean): Record<string, unknown>;
    };
    expect(build.buildRequestBody(params, true).think).toBe('medium');
  });
});
