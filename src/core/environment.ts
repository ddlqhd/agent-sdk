import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { win32 as pathWin32 } from 'node:path';

export interface EnvironmentInfo {
  cwd: string;
  platform: NodeJS.Platform;
  date: string;
  isGitRepo: boolean;
  shell: string | undefined;
}

// Cache for shell path to avoid repeated sync calls
let cachedShellPath: string | null = null;

/**
 * Find an executable in PATH using 'where' command (Windows only)
 */
function findInPath(executable: string): string | null {
  try {
    const result = execSync(`where ${executable}`, {
      encoding: 'utf-8',
      timeout: 1000
    }).trim().split('\n')[0];
    return result && existsSync(result) ? result : null;
  } catch {
    return null;
  }
}

/**
 * Resolve Git Bash from a Git for Windows git.exe path (any drive or parent folder).
 * Handles .../Git/cmd/git.exe, .../Git/bin/git.exe, and deeper mingw layouts.
 */
function findGitBashNextToGitExe(gitExe: string): string | null {
  if (!existsSync(gitExe)) {
    return null;
  }
  const dir = pathWin32.dirname(gitExe);
  const siblingBash = pathWin32.join(dir, 'bash.exe');
  if (existsSync(siblingBash)) {
    return siblingBash;
  }
  let walk = dir;
  for (let i = 0; i < 4; i++) {
    const bashPath = pathWin32.join(walk, 'bin', 'bash.exe');
    if (existsSync(bashPath)) {
      return bashPath;
    }
    const parent = pathWin32.dirname(walk);
    if (parent === walk) {
      break;
    }
    walk = parent;
  }
  return null;
}

function findBashViaGitInstall(): string | null {
  const gitExe = findInPath('git');
  if (!gitExe) {
    return null;
  }
  return findGitBashNextToGitExe(gitExe);
}

/** Typical Git for Windows locations (C/D/E cover non–system-drive installs). */
function findGitBashInDefaultInstallDirs(): string | null {
  const drives = ['C', 'D', 'E'];
  const relatives = [
    ['Program Files', 'Git', 'bin', 'bash.exe'],
    ['Program Files (x86)', 'Git', 'bin', 'bash.exe']
  ] as const;
  for (const drive of drives) {
    const root = `${drive}:\\`;
    for (const parts of relatives) {
      const p = pathWin32.join(root, ...parts);
      if (existsSync(p)) {
        return p;
      }
    }
  }
  return null;
}

/**
 * Get the shell path with caching to improve performance
 */
export function getShellPath(): string {
  // Return cached result if available
  if (cachedShellPath !== null) {
    return cachedShellPath;
  }

  if (process.platform === 'win32') {
    // Priority: bash in PATH > Git for Windows (via git.exe) > default install dirs > pwsh > powershell
    const bashPath = findInPath('bash');
    if (bashPath) {
      cachedShellPath = bashPath;
      return bashPath;
    }

    const viaGit = findBashViaGitInstall();
    if (viaGit) {
      cachedShellPath = viaGit;
      return viaGit;
    }

    const fromDirs = findGitBashInDefaultInstallDirs();
    if (fromDirs) {
      cachedShellPath = fromDirs;
      return fromDirs;
    }

    const pwshPath = findInPath('pwsh');
    if (pwshPath) {
      cachedShellPath = 'pwsh';
      return 'pwsh';
    }

    cachedShellPath = 'powershell.exe';
    return 'powershell.exe';
  }

  // Unix: use SHELL env or fallback to bash
  cachedShellPath = process.env.SHELL || '/bin/bash';
  return cachedShellPath;
}

export function getEnvironmentInfo(cwd: string): EnvironmentInfo {
  let isGitRepo = false;
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd,
      stdio: 'pipe',
      timeout: 2000
    });
    isGitRepo = true;
  } catch { /* not a git repo */ }

  const shellPath = getShellPath();
  const shell = shellPath.split(/[/\\]/).pop()?.replace(/\.exe$/i, '');

  return {
    cwd,
    platform: process.platform,
    date: new Date().toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }),
    isGitRepo,
    shell
  };
}

export function formatEnvironmentSection(info: EnvironmentInfo): string {
  const shellLine = info.shell ? `\n  Shell: ${info.shell}` : '';
  return `
## Environment

<env>
  Working directory: ${info.cwd}
  Platform: ${info.platform}
  Today's date: ${info.date}
  Is git repo: ${info.isGitRepo ? 'yes' : 'no'}${shellLine}
</env>`;
}
