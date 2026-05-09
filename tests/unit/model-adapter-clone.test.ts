import { describe, it, expect } from 'vitest';
import { OpenAIAdapter } from '../../src/models/openai.js';
import { AnthropicAdapter } from '../../src/models/anthropic.js';
import { OllamaAdapter } from '../../src/models/ollama.js';

describe('ModelAdapter clone + setModel', () => {
  it('OpenAIAdapter clone copies config; setModel updates name', () => {
    const a = new OpenAIAdapter({
      apiKey: 'k',
      baseUrl: 'https://api.example/v1',
      model: 'gpt-4o'
    });
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.name).toBe('openai/gpt-4o');
    b.setModel('gpt-4o-mini');
    expect(b.name).toBe('openai/gpt-4o-mini');
    expect(a.name).toBe('openai/gpt-4o');
  });

  it('AnthropicAdapter clone copies config; setModel updates name', () => {
    const a = new AnthropicAdapter({
      apiKey: 'k',
      baseUrl: 'https://anthropic.example',
      model: 'claude-3-5-sonnet'
    });
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.name).toBe('anthropic/claude-3-5-sonnet');
    b.setModel('claude-3-5-haiku');
    expect(b.name).toBe('anthropic/claude-3-5-haiku');
  });

  it('OllamaAdapter clone copies config; setModel updates name', () => {
    const a = new OllamaAdapter({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'llama3'
    });
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.name).toBe('ollama/llama3');
    b.setModel('mistral');
    expect(b.name).toBe('ollama/mistral');
  });
});
