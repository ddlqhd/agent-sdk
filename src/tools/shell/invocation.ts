import { win32 as pathWin32, posix as pathPosix } from 'node:path';

export interface ShellInvocation {
  /** Executable file to pass as the first argument of child_process.spawn */
  file: string;
  /** Argument vector to pass as the second argument of child_process.spawn */
  args: string[];
  /** Whether spawn should pass arguments verbatim on Windows (no extra escaping) */
  windowsVerbatimArguments: boolean;
}

/**
 * Extract the lowercase shell name from a shell path. Strips a trailing `.exe`.
 * Works with both POSIX and Windows separators.
 */
function shellBaseName(shellPath: string): string {
  const winBase = pathWin32.basename(shellPath);
  const posixBase = pathPosix.basename(winBase);
  return posixBase.toLowerCase().replace(/\.exe$/i, '');
}

/**
 * Build a spawn invocation that runs `command` through the given shell without
 * being subjected to Node's cmd.exe-style command-line synthesis on Windows.
 *
 * Background: `spawn(cmd, [], { shell })` on Windows always wraps `command`
 * with `/d /s /c "..."` cmd.exe quoting regardless of which shell binary is
 * set, so Git Bash / pwsh / powershell see `/d /s /c` as bogus arguments and
 * any `"`, `$`, `` ` ``, `!`, `(`, `)` characters get mangled by the cmd
 * quoting layer. This helper instead emits the right argv per shell and lets
 * `child_process.spawn` (without `shell`) do standard CRT-compatible argument
 * escaping, which is exactly what bash/pwsh/powershell expect.
 *
 * `windowsVerbatimArguments` is only enabled for `cmd.exe`, whose `/c`
 * handling parses the command tail with its own quirky rules instead of
 * standard MSVCRT argv parsing. For other shells, verbatim mode would break
 * any executable path that contains spaces (e.g. `C:\\Program Files\\Git\\bin\\bash.exe`)
 * because libuv would not quote argv[0].
 */
export function buildShellInvocation(command: string, shellPath: string): ShellInvocation {
  const name = shellBaseName(shellPath);

  if (name === 'bash' || name === 'sh' || name === 'zsh' || name === 'dash' || name === 'ash') {
    return {
      file: shellPath,
      args: ['-c', command],
      windowsVerbatimArguments: false
    };
  }

  if (name === 'pwsh' || name === 'powershell') {
    return {
      file: shellPath,
      args: ['-NoProfile', '-NonInteractive', '-Command', command],
      windowsVerbatimArguments: false
    };
  }

  if (name === 'cmd') {
    return {
      file: shellPath,
      args: ['/d', '/s', '/c', command],
      windowsVerbatimArguments: true
    };
  }

  return {
    file: shellPath,
    args: ['-c', command],
    windowsVerbatimArguments: false
  };
}
