import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getUserSettingsPath,
  loadUserSettings,
  mergeUserSettings,
  parseUserSettings,
  persistConfigureSettings,
  saveUserSettings,
  settingsFromConfigure
} from '../../packages/agent-sdk-cli/src/utils/user-settings.js';

describe('parseUserSettings', () => {
  it('returns null for missing version or non-objects', () => {
    expect(parseUserSettings(null)).toBeNull();
    expect(parseUserSettings({})).toBeNull();
    expect(parseUserSettings({ version: 2 })).toBeNull();
  });

  it('parses a v1 document and ignores unknown keys', () => {
    const parsed = parseUserSettings({
      version: 1,
      extra: true,
      'agent-default-model': {
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        temperature: 0.2,
        thinking: true,
        thinkingLevel: 'high',
        apiKey: 'should-ignore'
      },
      agent: { memory: false, contextManagement: true, contextLength: 128000, mcpConfigPath: 'mcp.json' },
      web: { storage: 'jsonl', safeToolsOnly: true }
    });
    expect(parsed).toEqual({
      version: 1,
      agentDefaultModel: {
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        temperature: 0.2,
        thinking: true,
        thinkingLevel: 'high'
      },
      agent: {
        memory: false,
        contextManagement: true,
        contextLength: 128000,
        mcpConfigPath: 'mcp.json'
      },
      web: { storage: 'jsonl', safeToolsOnly: true }
    });
  });
});

describe('loadUserSettings / saveUserSettings', () => {
  it('returns null when the file is missing or invalid JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'user-settings-'));
    expect(loadUserSettings(root)).toBeNull();
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(getUserSettingsPath(root), '{not-json', 'utf8');
    expect(loadUserSettings(root)).toBeNull();
  });

  it('atomically writes and reloads, keeping mode 0600 when the OS allows it', () => {
    const root = mkdtempSync(join(tmpdir(), 'user-settings-'));
    saveUserSettings(root, {
      version: 1,
      agentDefaultModel: { provider: 'ollama', model: 'llama3' }
    });
    const path = getUserSettingsPath(root);
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { version: number };
    expect(raw.version).toBe(1);
    expect(loadUserSettings(root)?.agentDefaultModel).toEqual({
      provider: 'ollama',
      model: 'llama3'
    });
    if (process.platform !== 'win32') {
      chmodSync(path, 0o644);
      saveUserSettings(root, {
        version: 1,
        agentDefaultModel: { provider: 'openai', model: 'gpt-4o' }
      });
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });
});

describe('mergeUserSettings / persistConfigureSettings', () => {
  it('lets a later patch override fields without dropping siblings', () => {
    const merged = mergeUserSettings(
      {
        version: 1,
        agentDefaultModel: { provider: 'openai', model: 'gpt-4o', temperature: 0.7 },
        agent: { memory: true }
      },
      {
        version: 1,
        agentDefaultModel: { provider: 'anthropic', model: 'claude-x' }
      }
    );
    expect(merged.agentDefaultModel).toEqual({
      provider: 'anthropic',
      model: 'claude-x',
      temperature: 0.7
    });
    expect(merged.agent).toEqual({ memory: true });
  });

  it('treats null patch fields as deletions', () => {
    const merged = mergeUserSettings(
      {
        version: 1,
        agentDefaultModel: {
          provider: 'openai',
          model: 'gpt-4o',
          temperature: 0.7,
          thinking: true,
          thinkingLevel: 'high'
        },
        agent: { memory: true, contextLength: 128000, mcpConfigPath: 'mcp.json' }
      },
      {
        version: 1,
        agentDefaultModel: { temperature: null, thinking: null, thinkingLevel: null },
        agent: { contextLength: null, mcpConfigPath: null }
      }
    );
    expect(merged.agentDefaultModel).toEqual({ provider: 'openai', model: 'gpt-4o' });
    expect(merged.agent).toEqual({ memory: true });
  });

  it('writes configure fields and does not persist cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'user-settings-'));
    persistConfigureSettings(root, {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.4,
      storage: 'jsonl',
      safeToolsOnly: false,
      memory: true,
      contextManagement: true,
      mcpConfigPath: 'mcp.json'
    });
    const stored = loadUserSettings(root);
    expect(stored?.agentDefaultModel?.model).toBe('gpt-4o');
    expect(stored?.agent?.mcpConfigPath).toBe('mcp.json');
    expect(JSON.stringify(stored)).not.toContain('cwd');
    expect(settingsFromConfigure({
      provider: 'openai',
      model: 'x',
      storage: 'memory'
    }).agentDefaultModel?.provider).toBe('openai');
  });

  it('clears omitted optional configure fields on a later persist', () => {
    const root = mkdtempSync(join(tmpdir(), 'user-settings-'));
    persistConfigureSettings(root, {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.4,
      thinking: true,
      thinkingLevel: 'high',
      storage: 'jsonl',
      memory: true,
      contextManagement: true,
      contextLength: 64000,
      mcpConfigPath: 'mcp.json'
    });
    persistConfigureSettings(root, {
      provider: 'anthropic',
      model: 'claude-x',
      storage: 'memory',
      memory: false,
      contextManagement: false
    });
    const stored = loadUserSettings(root);
    expect(stored).toEqual({
      version: 1,
      agentDefaultModel: { provider: 'anthropic', model: 'claude-x' },
      agent: { memory: false, contextManagement: false },
      web: { storage: 'memory', safeToolsOnly: false }
    });
    expect(stored?.agentDefaultModel).not.toHaveProperty('temperature');
    expect(stored?.agent).not.toHaveProperty('mcpConfigPath');
    expect(stored?.agent).not.toHaveProperty('contextLength');
  });
});
