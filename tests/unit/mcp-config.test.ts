import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadMCPConfig,
  validateMCPConfig,
  type MCPConfigFile
} from '../../src/config/mcp-config.js';

describe('validateMCPConfig toolTimeoutMs', () => {
  it('accepts missing toolTimeoutMs', () => {
    const c: MCPConfigFile = {
      mcpServers: {
        a: { command: 'node', args: ['x.js'] }
      }
    };
    expect(validateMCPConfig(c)).toEqual([]);
  });

  it('accepts 0', () => {
    const c: MCPConfigFile = {
      mcpServers: {
        a: { command: 'node', toolTimeoutMs: 0 }
      }
    };
    expect(validateMCPConfig(c)).toEqual([]);
  });

  it('accepts positive number', () => {
    const c: MCPConfigFile = {
      mcpServers: {
        a: { command: 'node', toolTimeoutMs: 5000 }
      }
    };
    expect(validateMCPConfig(c)).toEqual([]);
  });

  it('rejects negative', () => {
    const c: MCPConfigFile = {
      mcpServers: {
        a: { command: 'node', toolTimeoutMs: -1 }
      }
    };
    expect(validateMCPConfig(c).length).toBe(1);
  });

  it('rejects non-finite', () => {
    const c = {
      mcpServers: {
        a: { command: 'node', toolTimeoutMs: Number.NaN }
      }
    } as MCPConfigFile;
    expect(validateMCPConfig(c).length).toBe(1);
  });

  it('rejects non-number', () => {
    const c = {
      mcpServers: {
        a: { command: 'node', toolTimeoutMs: '5000' as unknown as number }
      }
    } as MCPConfigFile;
    expect(validateMCPConfig(c).length).toBe(1);
  });
});

describe('loadMCPConfig toolTimeoutMs', () => {
  let configPath: string;
  beforeEach(() => {
    configPath = join(
      tmpdir(),
      `mcp-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
  });
  afterEach(() => {
    if (existsSync(configPath)) unlinkSync(configPath);
  });

  it('loads toolTimeoutMs into MCPServerConfig', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          fs: {
            command: 'npx',
            args: ['-y', '@x/y'],
            toolTimeoutMs: 120000
          }
        }
      })
    );
    const { servers } = loadMCPConfig(configPath);
    expect(servers).toHaveLength(1);
    expect(servers[0].toolTimeoutMs).toBe(120000);
  });

  it('omits toolTimeoutMs when 0', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          fs: {
            command: 'npx',
            toolTimeoutMs: 0
          }
        }
      })
    );
    const { servers } = loadMCPConfig(configPath);
    expect(servers[0].toolTimeoutMs).toBeUndefined();
  });
});
