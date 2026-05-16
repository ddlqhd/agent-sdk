import { describe, it, expect } from 'vitest';
import { buildShellInvocation } from '../../src/tools/shell/invocation.js';

/**
 * `buildShellInvocation` is driven only by the shell executable basename
 * (bash, pwsh, cmd, …), not by `process.platform`. These tests must not
 * mutate `process.platform`; results are identical on Windows, Linux, and macOS.
 */
describe('buildShellInvocation', () => {
  describe('bash family (basename bash/sh/zsh/dash/ash)', () => {
    it('uses -c and non-verbatim so Windows paths with spaces in argv[0] stay quoted', () => {
      const inv = buildShellInvocation(
        'echo "hello $USER"',
        'C:\\Program Files\\Git\\bin\\bash.exe'
      );
      expect(inv.file).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
      expect(inv.args).toEqual(['-c', 'echo "hello $USER"']);
      expect(inv.windowsVerbatimArguments).toBe(false);
    });

    it('uses -c for POSIX bash path', () => {
      const inv = buildShellInvocation('echo hi', '/bin/bash');
      expect(inv.file).toBe('/bin/bash');
      expect(inv.args).toEqual(['-c', 'echo hi']);
      expect(inv.windowsVerbatimArguments).toBe(false);
    });

    it('detects zsh by basename', () => {
      const inv = buildShellInvocation('echo hi', '/usr/bin/zsh');
      expect(inv.args).toEqual(['-c', 'echo hi']);
      expect(inv.windowsVerbatimArguments).toBe(false);
    });

    it('passes the user command through unchanged for tricky characters', () => {
      const tricky = `cd "path with space" && echo $VAR && ls \`pwd\` && printf '!'`;
      const inv = buildShellInvocation(tricky, 'D:\\Git\\bin\\bash.exe');
      expect(inv.args[1]).toBe(tricky);
    });
  });

  describe('PowerShell (pwsh / powershell)', () => {
    it('emits -NoProfile -NonInteractive -Command for pwsh', () => {
      const inv = buildShellInvocation('Get-ChildItem -Force', 'pwsh');
      expect(inv.file).toBe('pwsh');
      expect(inv.args).toEqual([
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-ChildItem -Force'
      ]);
      expect(inv.windowsVerbatimArguments).toBe(false);
    });

    it('emits the same for powershell.exe', () => {
      const inv = buildShellInvocation('Write-Output `hi`', 'powershell.exe');
      expect(inv.args).toEqual([
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Write-Output `hi`'
      ]);
      expect(inv.windowsVerbatimArguments).toBe(false);
    });
  });

  describe('cmd', () => {
    it('uses /d /s /c with windowsVerbatimArguments', () => {
      const inv = buildShellInvocation('echo hi && dir', 'cmd.exe');
      expect(inv.file).toBe('cmd.exe');
      expect(inv.args).toEqual(['/d', '/s', '/c', 'echo hi && dir']);
      expect(inv.windowsVerbatimArguments).toBe(true);
    });
  });

  describe('unknown shell basename', () => {
    it('falls back to -c', () => {
      const inv = buildShellInvocation('echo hi', '/opt/custom/myshell');
      expect(inv.file).toBe('/opt/custom/myshell');
      expect(inv.args).toEqual(['-c', 'echo hi']);
      expect(inv.windowsVerbatimArguments).toBe(false);
    });
  });
});
