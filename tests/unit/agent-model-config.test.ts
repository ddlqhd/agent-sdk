import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import type { AgentConfig } from '../../src/core/types.js';
import { OpenAIAdapter } from '../../src/models/openai.js';

describe('Agent modelConfig + mergeProcessEnv', () => {
  const key = 'OPENAI_API_KEY';

  it('rejects both model and modelConfig', () => {
    const model = new OpenAIAdapter({ apiKey: 'x', model: 'gpt-4o-mini' });
    expect(
      () =>
        new Agent({
          model,
          modelConfig: { provider: 'openai', model: 'gpt-4o-mini' }
        })
    ).toThrow('only one of `model` or `modelConfig`');
  });

  it('rejects neither model nor modelConfig', () => {
    expect(() => new Agent({} as AgentConfig)).toThrow('`model` or `modelConfig` is required');
  });

  it('uses AgentConfig.env for OpenAI key when using modelConfig', () => {
    const prev = process.env[key];
    delete process.env[key];
    try {
      const agent = new Agent({
        modelConfig: { provider: 'openai', model: 'gpt-4o-mini' },
        env: { [key]: 'sk-from-agent-env' }
      });
      expect(agent.getModel()).toBeInstanceOf(OpenAIAdapter);
      expect(agent.getModel().name).toContain('openai');
    } finally {
      if (prev !== undefined) process.env[key] = prev;
    }
  });

  it('getModel returns the resolved adapter', () => {
    const agent = new Agent({
      modelConfig: { provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini' }
    });
    expect(agent.getModel()).toBe(agent.getModel());
  });
});
