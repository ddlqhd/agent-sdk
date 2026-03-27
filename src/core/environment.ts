import { existsSync } from 'fs';
import { execSync } from 'child_process';

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
 * Get the shell path with caching to improve performance
 */
export function getShellPath(): string {
  // Return cached result if available
  if (cachedShellPath !== null) {
    return cachedShellPath;
  }

  if (process.platform === 'win32') {
    // Priority: Git Bash > system bash > pwsh > powershell
    // Use 'where' command first to find bash in PATH (covers scoop, chocolatey, custom installs)
    const bashPath = findInPath('bash');
    if (bashPath) {
      cachedShellPath = bashPath;
      return bashPath;
    }

    // Check Git Bash in common install locations
    const gitBashPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ];
    for (const path of gitBashPaths) {
      if (existsSync(path)) {
        cachedShellPath = path;
        return path;
      }
    }

    // Check for PowerShell Core (pwsh)
    const pwshPath = findInPath('pwsh');
    if (pwshPath) {
      cachedShellPath = 'pwsh';
      return 'pwsh';
    }

    // Fallback to Windows PowerShell
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