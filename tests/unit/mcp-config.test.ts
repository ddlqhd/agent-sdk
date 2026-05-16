import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'fs';
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

describe('validateMCPConfig connectTimeoutMs', () => {
  it('accepts missing connectTimeoutMs', () => {
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
        a: { command: 'node', connectTimeoutMs: 0 }
      }
    };
    expect(validateMCPConfig(c)).toEqual([]);
  });

  it('accepts positive number', () => {
    const c: MCPConfigFile = {
      mcpServers: {
        a: { command: 'node', connectTimeoutMs: 5000 }
      }
    };
    expect(validateMCPConfig(c)).toEqual([]);
  });

  it('rejects negative', () => {
    const c: MCPConfigFile = {
      mcpServers: {
        a: { command: 'node', connectTimeoutMs: -1 }
      }
    };
    expect(validateMCPConfig(c).length).toBe(1);
  });

  it('rejects non-finite', () => {
    const c = {
      mcpServers: {
        a: { command: 'node', connectTimeoutMs: Number.NaN }
      }
    } as MCPConfigFile;
    expect(validateMCPConfig(c).length).toBe(1);
  });

  it('rejects non-number', () => {
    const c = {
      mcpServers: {
        a: { command: 'node', connectTimeoutMs: '5000' as unknown as number }
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

describe('loadMCPConfig connectTimeoutMs', () => {
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

  it('loads connectTimeoutMs into MCPServerConfig', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          fs: {
            command: 'npx',
            args: ['-y', '@x/y'],
            connectTimeoutMs: 120000
          }
        }
      })
    );
    const { servers } = loadMCPConfig(configPath);
    expect(servers).toHaveLength(1);
    expect(servers[0].connectTimeoutMs).toBe(120000);
  });

  it('omits connectTimeoutMs when 0', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          fs: {
            command: 'npx',
            connectTimeoutMs: 0
          }
        }
      })
    );
    const { servers } = loadMCPConfig(configPath);
    expect(servers[0].connectTimeoutMs).toBeUndefined();
  });
});

describe('loadMCPConfig errors and validation', () => {
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

  it('returns path_not_found for explicit missing file', () => {
    const missing = join(tmpdir(), `missing-mcp-${Date.now()}.json`);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = loadMCPConfig(missing);
      expect(r.servers).toEqual([]);
      expect(r.errors).toBeDefined();
      expect(r.errors?.[0].kind).toBe('path_not_found');
      expect(r.errors?.[0].path).toBe(missing);
      expect(r.configPath).toBe(missing);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('skips invalid server but still loads other servers in the same file', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          bad: {
            command: 'node',
            url: 'http://example.com'
          },
          good: {
            command: 'node',
            args: ['-e', '0']
          }
        }
      })
    );
    const r = loadMCPConfig(configPath);
    expect(r.servers).toHaveLength(1);
    expect(r.servers[0].name).toBe('good');
    expect(r.errors?.some(e => e.kind === 'validation_error' && e.serverName === 'bad')).toBe(true);
    expect(
      r.errors?.find(e => e.serverName === 'bad')?.validationMessages?.length
    ).toBeGreaterThan(0);
  });
});

describe('loadMCPConfig missing environment variables', () => {
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

  it('reports missing_env_var error when config references an undefined variable', () => {
    const uniqueVar = `MCP_TEST_MISSING_VAR_${Date.now()}`;
    // Ensure the variable is definitely not set
    delete process.env[uniqueVar];

    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          myserver: {
            command: 'npx',
            env: { TOKEN: `\${${uniqueVar}}` }
          }
        }
      })
    );

    const r = loadMCPConfig(configPath);
    expect(r.servers).toHaveLength(1);
    const missingErr = r.errors?.find(e => e.kind === 'missing_env_var');
    expect(missingErr).toBeDefined();
    expect(missingErr?.validationMessages).toContain(uniqueVar);
  });

  it('does not report missing_env_var for variables that are defined', () => {
    process.env['MCP_TEST_PRESENT_VAR'] = 'hello';
    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          mcpServers: {
            myserver: {
              command: 'node',
              env: { TOKEN: '${MCP_TEST_PRESENT_VAR}' }
            }
          }
        })
      );

      const r = loadMCPConfig(configPath);
      expect(r.errors?.some(e => e.kind === 'missing_env_var')).toBeFalsy();
      expect(r.servers[0].env?.TOKEN).toBe('hello');
    } finally {
      delete process.env['MCP_TEST_PRESENT_VAR'];
    }
  });
});

describe('loadMCPConfig merge skips bad user fragment', () => {
  it('merges workspace servers when user file is invalid JSON', () => {
    const fakeHome = join(tmpdir(), `fakehome-${Date.now()}`);
    const userClaude = join(fakeHome, '.claude');
    const wsRoot = join(tmpdir(), `ws-${Date.now()}`);
    const wsClaude = join(wsRoot, '.claude');

    mkdirSync(userClaude, { recursive: true });
    mkdirSync(wsClaude, { recursive: true });

    writeFileSync(join(userClaude, 'mcp_config.json'), '{ not valid json');
    writeFileSync(
      join(wsClaude, 'mcp_config.json'),
      JSON.stringify({
        mcpServers: {
          ok: { command: 'node', args: ['-e', 'process.exit(0)'] }
        }
      })
    );

    try {
      const r = loadMCPConfig(undefined, wsRoot, fakeHome);
      expect(r.servers).toHaveLength(1);
      expect(r.servers[0].name).toBe('ok');
      expect(r.errors?.length).toBeGreaterThan(0);
      expect(r.errors?.some(e => e.kind === 'parse_error')).toBe(true);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(wsRoot, { recursive: true, force: true });
    }
  });
});
