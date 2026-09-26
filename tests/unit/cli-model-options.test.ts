import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import {
  addModelOptions,
  addHeadlessOptions,
  modelConfigFromOptions,
  parseProviderCli,
  resolveCliModelSelection
} from '../../packages/agent-sdk-cli/src/utils/agent-bootstrap.js';

describe('parseProviderCli', () => {
  it('accepts known providers case-insensitively', () => {
    expect(parseProviderCli('openai')).toBe('openai');
    expect(parseProviderCli('Anthropic')).toBe('anthropic');
    expect(parseProviderCli(' OLLAMA ')).toBe('ollama');
  });

  it('throws on unknown provider', () => {
    expect(() => parseProviderCli('foo')).toThrow(/Invalid --provider: foo/);
  });
});

describe('resolveCliModelSelection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses --provider and --model', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      resolveCliModelSelection({ provider: 'anthropic', model: 'claude-xxx' })
    ).toEqual({ provider: 'anthropic', model: 'claude-xxx' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('defaults provider to openai when only --model is a model id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveCliModelSelection({ model: 'gpt-4o' })).toEqual({
      provider: 'openai',
      model: 'gpt-4o'
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('treats legacy --model openai as provider', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveCliModelSelection({ model: 'openai' })).toEqual({
      provider: 'openai',
      model: undefined
    });
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/--provider openai/);
  });

  it('treats legacy --model anthropic --model-name as old combo', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      resolveCliModelSelection({ model: 'anthropic', modelName: 'claude-xxx' })
    ).toEqual({ provider: 'anthropic', model: 'claude-xxx' });
    const messages = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(messages).toMatch(/--provider anthropic/);
    expect(messages).toMatch(/--model-name is deprecated/);
  });

  it('does not apply legacy heuristic when --provider is set', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      resolveCliModelSelection({ provider: 'anthropic', model: 'openai' })
    ).toEqual({ provider: 'anthropic', model: 'openai' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses hidden --model-name when --model is omitted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveCliModelSelection({ modelName: 'gpt-4o' })).toEqual({
      provider: 'openai',
      model: 'gpt-4o'
    });
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/--model-name is deprecated/);
  });

  it('throws on invalid --provider', () => {
    expect(() => resolveCliModelSelection({ provider: 'foo' })).toThrow(/Invalid --provider: foo/);
  });

  it('uses persisted settings when flags are omitted', () => {
    expect(
      resolveCliModelSelection(
        {},
        { version: 1, agentDefaultModel: { provider: 'anthropic', model: 'claude-xxx' } }
      )
    ).toEqual({ provider: 'anthropic', model: 'claude-xxx' });
  });

  it('lets explicit --provider/--model override settings', () => {
    expect(
      resolveCliModelSelection(
        { provider: 'openai', model: 'gpt-4o' },
        { version: 1, agentDefaultModel: { provider: 'anthropic', model: 'claude-xxx' } }
      )
    ).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });
});

describe('modelConfigFromOptions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps resolved selection plus shared fields', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = modelConfigFromOptions({
      provider: 'ollama',
      model: 'llama3',
      apiKey: 'k',
      baseUrl: 'http://localhost:11434',
      thinking: true,
      thinkingLevel: 'high'
    });
    expect(cfg).toEqual({
      provider: 'ollama',
      model: 'llama3',
      apiKey: 'k',
      baseUrl: 'http://localhost:11434',
      thinking: true,
      thinkingLevel: 'high'
    });
  });

  it('fills thinking from settings when flags omit it', () => {
    const cfg = modelConfigFromOptions(
      { provider: 'openai' },
      { version: 1, agentDefaultModel: { thinking: false, thinkingLevel: 'low' } }
    );
    expect(cfg.thinking).toBe(false);
    expect(cfg.thinkingLevel).toBe('low');
  });

  it('uses a saved baseUrl unless --base-url is set', () => {
    const saved = modelConfigFromOptions(
      { provider: 'openai' },
      { version: 1, agentDefaultModel: { baseUrl: 'https://saved.example/v1' } }
    );
    expect(saved.baseUrl).toBe('https://saved.example/v1');
    const flagged = modelConfigFromOptions(
      { provider: 'openai', baseUrl: 'https://flag.example/v1' },
      { version: 1, agentDefaultModel: { baseUrl: 'https://saved.example/v1' } }
    );
    expect(flagged.baseUrl).toBe('https://flag.example/v1');
  });

  it('uses a saved apiKey unless --api-key is set', () => {
    const saved = modelConfigFromOptions(
      { provider: 'openai' },
      { version: 1, agentDefaultModel: { apiKey: 'sk-saved' } }
    );
    expect(saved.apiKey).toBe('sk-saved');
    const flagged = modelConfigFromOptions(
      { provider: 'openai', apiKey: 'sk-flag' },
      { version: 1, agentDefaultModel: { apiKey: 'sk-saved' } }
    );
    expect(flagged.apiKey).toBe('sk-flag');
  });

  it('does not apply a saved apiKey or baseUrl for a different provider', () => {
    const cfg = modelConfigFromOptions(
      { provider: 'anthropic' },
      {
        version: 1,
        agentDefaultModel: {
          provider: 'openai',
          apiKey: 'sk-saved',
          baseUrl: 'https://saved.example/v1'
        }
      }
    );
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.apiKey).toBeUndefined();
    expect(cfg.baseUrl).toBeUndefined();
    const flagged = modelConfigFromOptions(
      { provider: 'anthropic', apiKey: 'sk-flag', baseUrl: 'https://flag.example' },
      {
        version: 1,
        agentDefaultModel: {
          provider: 'openai',
          apiKey: 'sk-saved',
          baseUrl: 'https://saved.example/v1'
        }
      }
    );
    expect(flagged.apiKey).toBe('sk-flag');
    expect(flagged.baseUrl).toBe('https://flag.example');
  });
});

describe('addModelOptions help and parse', () => {
  it('shows --provider and hides --model-name', () => {
    const program = new Command();
    addModelOptions(addHeadlessOptions(program));
    const help = program.helpInformation();
    expect(help).toContain('--provider');
    expect(help).toContain('--model');
    expect(help).toContain('overrides a key saved in settings');
    expect(help).not.toContain('--model-name');
  });

  it('parses Goose-style flags through Commander', () => {
    const program = new Command();
    addModelOptions(program);
    program.parse(['node', 'cli', '--provider', 'anthropic', '--model', 'claude-xxx'], { from: 'user' });
    const opts = program.opts();
    expect(opts.provider).toBe('anthropic');
    expect(opts.model).toBe('claude-xxx');
    expect(resolveCliModelSelection(opts)).toEqual({
      provider: 'anthropic',
      model: 'claude-xxx'
    });
  });
});
