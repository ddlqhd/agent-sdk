import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Command } from 'commander';
import {
  parseAllowedTools,
  normalizeOutputFormat,
  resolvePrintPrompt,
  readStdin,
  isHeadlessCli,
  PRINT_STDIN_MAX_BYTES
} from '../../src/cli/utils/print-prompt.js';
import {
  addHeadlessOptions,
  addModelOptions,
  buildCliAgentConfig,
  reportMCPConfigLoad
} from '../../src/cli/utils/agent-bootstrap.js';
import { createChatCommand } from '../../src/cli/commands/chat.js';

describe('print-prompt helpers', () => {
  describe('parseAllowedTools', () => {
    it('parses comma-separated names with trim', () => {
      expect(parseAllowedTools('Bash, Read , Edit')).toEqual(['Bash', 'Read', 'Edit']);
    });

    it('throws on empty string', () => {
      expect(() => parseAllowedTools('')).toThrow(/at least one tool name/);
      expect(() => parseAllowedTools('  ,  ')).toThrow(/at least one tool name/);
    });
  });

  describe('normalizeOutputFormat', () => {
    it('prefers --output-format over -o', () => {
      expect(normalizeOutputFormat({ output: 'text', outputFormat: 'json' }).output).toBe('json');
    });

    it('falls back to -o and defaults to text', () => {
      expect(normalizeOutputFormat({ output: 'json' }).output).toBe('json');
      expect(normalizeOutputFormat({}).output).toBe('text');
    });

    it('throws on invalid format', () => {
      expect(() => normalizeOutputFormat({ outputFormat: 'yaml' })).toThrow(/Invalid output format/);
    });
  });

  describe('isHeadlessCli', () => {
    it('returns true when print is set', () => {
      expect(isHeadlessCli({ print: 'hello' })).toBe(true);
      expect(isHeadlessCli({ print: true })).toBe(true);
      expect(isHeadlessCli({})).toBe(false);
    });
  });

  describe('readStdin', () => {
    const originalIsTTY = process.stdin.isTTY;

    afterEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    });

    it('returns empty string on TTY', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      await expect(readStdin()).resolves.toBe('');
    });

    it('reads piped data when not a TTY', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      const emitter = process.stdin as EventEmitter & { resume: () => void; destroy: () => void };
      const readPromise = readStdin();
      emitter.emit('data', Buffer.from('hello '));
      emitter.emit('data', Buffer.from('world'));
      emitter.emit('end');
      await expect(readPromise).resolves.toBe('hello world');
    });

    it('rejects when stdin exceeds max bytes', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      const emitter = process.stdin as EventEmitter & { resume: () => void; destroy: () => void };
      const readPromise = readStdin(4);
      emitter.emit('data', Buffer.from('12345'));
      await expect(readPromise).rejects.toThrow(/exceeds 4 byte limit/);
    });
  });

  describe('resolvePrintPrompt', () => {
    const originalIsTTY = process.stdin.isTTY;

    beforeEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    });

    it('uses instruction only when stdin is TTY', async () => {
      await expect(resolvePrintPrompt('hello')).resolves.toBe('hello');
    });

    it('combines instruction and piped stdin', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      const emitter = process.stdin as EventEmitter & { resume: () => void };
      const promise = resolvePrintPrompt('summarize');
      emitter.emit('data', Buffer.from('log line'));
      emitter.emit('end');
      await expect(promise).resolves.toBe('summarize\n\nlog line');
    });

    it('uses stdin only when no instruction', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      const emitter = process.stdin as EventEmitter & { resume: () => void };
      const promise = resolvePrintPrompt(true);
      emitter.emit('data', Buffer.from('only stdin'));
      emitter.emit('end');
      await expect(promise).resolves.toBe('only stdin');
    });

    it('throws when prompt is missing', async () => {
      await expect(resolvePrintPrompt(true)).rejects.toThrow(/Missing prompt/);
    });
  });
});

describe('buildCliAgentConfig bare mode', () => {
  it('sets bare AgentConfig flags and empty MCP servers', () => {
    const config = buildCliAgentConfig(
      { bare: true, print: 'test', allowedTools: ['Read'] },
      [],
      null
    );
    expect(config.loadSkills).toBe(false);
    expect(config.memory).toBe(false);
    expect(config.loadHookSettingsFromFiles).toBe(false);
    expect(config.subagent).toEqual({ enabled: false, loadProfilesFromFiles: false });
    expect(config.mcpServers).toEqual([]);
    expect(config.hookConfigDir).toBeUndefined();
    expect(config.allowedTools).toEqual(['Read']);
  });

  it('uses hookConfigDir in normal mode', () => {
    const config = buildCliAgentConfig({ cwd: '/proj' }, [], null);
    expect(config.hookConfigDir).toBe('/proj');
    expect(config.loadSkills).toBeUndefined();
  });
});

describe('reportMCPConfigLoad headless', () => {
  it('suppresses info logs in headless mode', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    reportMCPConfigLoad(
      { servers: [{ name: 'fs' } as never], configPath: '/tmp/mcp.json' },
      { headless: true }
    );
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

describe('CLI Commander wiring', () => {
  it('does not register run subcommand', () => {
    const program = new Command();
    program.addCommand(createChatCommand());
    expect(program.commands.some((c) => c.name() === 'run')).toBe(false);
  });

  it('registers -p on root program help', () => {
    const program = new Command();
    addModelOptions(addHeadlessOptions(program)).option(
      '-p, --print [prompt]',
      'Run non-interactively (headless mode)'
    );
    const help = program.helpInformation();
    expect(help).toContain('--print');
    expect(help).toContain('--bare');
    expect(help).toContain('--allowed-tools');
    expect(help).toContain('--continue');
  });
});

describe('PRINT_STDIN_MAX_BYTES', () => {
  it('is 10MB', () => {
    expect(PRINT_STDIN_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});
