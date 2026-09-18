import { describe, it, expect } from 'vitest';
import { OpenAIAdapter, openaiContentPartsToWire } from '../../packages/agent-sdk/src/models/openai.js';
import { buildAnthropicWireMessages, type AnthropicImageSource } from '../../packages/agent-sdk/src/models/anthropic.js';
import { ollamaMessageContentToApi } from '../../packages/agent-sdk/src/models/ollama.js';
import { messageContentToTranscriptText } from '../../packages/agent-sdk/src/core/compressor.js';
import { messagesToTerminalLines } from '../../packages/agent-sdk-cli/src/utils/chat-history.js';
import type { ContentPart, Message } from '../../packages/agent-sdk/src/core/types.js';

const base64Image: ContentPart = {
  type: 'image',
  source: { type: 'base64', data: 'abc', mimeType: 'image/png' }
};
const urlImage: ContentPart = {
  type: 'image',
  source: { type: 'url', url: 'https://ex.com/img.png' }
};

describe('OpenAI adapter image source mapping', () => {
  const adapter = new OpenAIAdapter({ apiKey: 'test' });

  it('base64 source → data URI', () => {
    const parts = openaiContentPartsToWire([base64Image]) as Array<{ type: string; image_url: { url: string } }>;
    expect(parts).toHaveLength(1);
    expect(parts[0]!.type).toBe('image_url');
    expect(parts[0]!.image_url.url).toBe('data:image/png;base64,abc');
  });

  it('url source → passthrough', () => {
    const parts = openaiContentPartsToWire([urlImage]) as Array<{ type: string; image_url: { url: string } }>;
    expect(parts[0]!.image_url.url).toBe('https://ex.com/img.png');
  });

  it('string input → passthrough', () => {
    expect(openaiContentPartsToWire('hello')).toBe('hello');
  });

  it('empty array → empty string (no parts)', () => {
    expect(openaiContentPartsToWire([])).toBe('');
  });

  it('tool role with text-only array → string', () => {
    const messages: Message[] = [
      {
        role: 'tool',
        toolCallId: 't1',
        content: [{ type: 'text', text: 'tool result text' }]
      }
    ];
    const wire = (adapter as unknown as { transformMessages(m: Message[]): unknown[] }).transformMessages(messages) as Array<{ role: string; content: unknown }>;
    expect(wire[0]!.role).toBe('tool');
    expect(wire[0]!.content).toBe('tool result text');
  });

  it('tool role with non-text parts → throws', () => {
    const messages: Message[] = [
      {
        role: 'tool',
        toolCallId: 't1',
        content: [
          { type: 'text', text: 'tool result text' },
          base64Image
        ]
      }
    ];
    expect(() =>
      (adapter as unknown as { transformMessages(m: Message[]): unknown[] }).transformMessages(messages)
    ).toThrow(/OpenAI tool messages require a string content/);
  });
});

describe('Anthropic adapter image source mapping', () => {
  it('base64 source → { type: base64, media_type, data }', () => {
    const wire = buildAnthropicWireMessages([
      { role: 'user', content: [base64Image] }
    ]) as Array<{ content: Array<{ type: string; source: AnthropicImageSource }> }>;
    const img = wire[0]!.content[0]!;
    expect(img.type).toBe('image');
    expect(img.source).toEqual({ type: 'base64', media_type: 'image/png', data: 'abc' });
  });

  it('url source → { type: url, url }', () => {
    const wire = buildAnthropicWireMessages([
      { role: 'user', content: [urlImage] }
    ]) as Array<{ content: Array<{ type: string; source: AnthropicImageSource }> }>;
    const img = wire[0]!.content[0]!;
    expect(img.source).toEqual({ type: 'url', url: 'https://ex.com/img.png' });
  });
});

describe('Ollama adapter image source mapping', () => {
  it('base64 source → images[]', () => {
    const result = ollamaMessageContentToApi([base64Image]);
    expect(result.images).toEqual(['abc']);
  });

  it('url source → throws', () => {
    expect(() => ollamaMessageContentToApi([urlImage])).toThrow(
      /Ollama does not support url-based image sources/
    );
  });
});

describe('Compressor image display', () => {
  it('reads source.mimeType for base64', () => {
    expect(messageContentToTranscriptText([base64Image])).toContain('[image: image/png]');
  });

  it('reads source.url for url', () => {
    expect(messageContentToTranscriptText([urlImage])).toContain('[image: https://ex.com/img.png]');
  });

  it('joins text + image with newlines', () => {
    const out = messageContentToTranscriptText([
      { type: 'text', text: 'hello' },
      base64Image
    ]);
    expect(out).toBe('hello\n[image: image/png]');
  });
});

describe('CLI chat history image display', () => {
  it('base64 → [image: mimeType]', () => {
    const lines = messagesToTerminalLines([
      { role: 'user', content: [base64Image] }
    ]);
    expect(lines).toContainEqual({ role: 'user', text: '[image: image/png]' });
  });

  it('url → [image: url]', () => {
    const lines = messagesToTerminalLines([
      { role: 'user', content: [urlImage] }
    ]);
    expect(lines).toContainEqual({ role: 'user', text: '[image: https://ex.com/img.png]' });
  });
});
