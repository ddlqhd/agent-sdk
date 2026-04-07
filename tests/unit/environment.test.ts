import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

vi.mock('child_process', () => ({
  execSync: vi.fn()
}));

vi.mock('fs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('fs')>();
  return {
    ...mod,
    existsSync: vi.fn()
  };
});

const mockedExecSync = vi.mocked(execSync);
const mockedExistsSync = vi.mocked(existsSync);

describe('getShellPath (win32)', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    mockedExecSync.mockReset();
    mockedExistsSync.mockReset();
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
      writable: true
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
      writable: true
    });
  });

  it('resolves Git Bash via git.exe in cmd/ on any drive', async () => {
    mockedExecSync.mockImplementation((cmd) => {
      const s = String(cmd);
      if (s.startsWith('where bash')) {
        throw new Error('not in path');
      }
      if (s.startsWith('where git')) {
        return 'D:\\Programs\\Git\\cmd\\git.exe\r\n';
      }
      throw new Error(`unexpected execSync: ${s}`);
    });
    mockedExistsSync.mockImplementation((p) => {
      const s = String(p).replace(/\//g, '\\');
      return s.endsWith('\\Programs\\Git\\cmd\\git.exe') || s.endsWith('\\Programs\\Git\\bin\\bash.exe');
    });

    const { getShellPath } = await import('../../src/core/environment.js');
    expect(getShellPath()).toBe('D:\\Programs\\Git\\bin\\bash.exe');
  });

  it('prefers bash.exe beside git.exe in bin/', async () => {
    mockedExecSync.mockImplementation((cmd) => {
      const s = String(cmd);
      if (s.startsWith('where bash')) {
        throw new Error('not in path');
      }
      if (s.startsWith('where git')) {
        return 'E:\\Git\\bin\\git.exe\n';
      }
      throw new Error(`unexpected execSync: ${s}`);
    });
    mockedExistsSync.mockImplementation((p) => {
      const s = String(p).replace(/\//g, '\\');
      return s === 'E:\\Git\\bin\\git.exe' || s === 'E:\\Git\\bin\\bash.exe';
    });

    const { getShellPath } = await import('../../src/core/environment.js');
    expect(getShellPath()).toBe('E:\\Git\\bin\\bash.exe');
  });

  it('falls back to D:\\Program Files\\Git when bash/git are not in PATH', async () => {
    mockedExecSync.mockImplementation((cmd) => {
      const s = String(cmd);
      if (s.startsWith('where bash') || s.startsWith('where git') || s.startsWith('where pwsh')) {
        throw new Error('not in path');
      }
      throw new Error(`unexpected execSync: ${s}`);
    });
    mockedExistsSync.mockImplementation((p) => {
      const norm = String(p).replace(/\//g, '\\').toLowerCase();
      return norm === 'd:\\program files\\git\\bin\\bash.exe';
    });

    const { getShellPath } = await import('../../src/core/environment.js');
    expect(getShellPath().replace(/\//g, '\\').toLowerCase()).toBe(
      'd:\\program files\\git\\bin\\bash.exe'
    );
  });
});
