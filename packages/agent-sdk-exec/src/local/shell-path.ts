import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { win32 as pathWin32 } from 'node:path';

let cachedShellPath: string | null = null;

function findInPath(executable: string): string | null {
  try {
    const result = execSync(`where ${executable}`, {
      encoding: 'utf-8',
      timeout: 1000
    })
      .trim()
      .split('\n')[0];
    return result && existsSync(result) ? result : null;
  } catch {
    return null;
  }
}

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

/** Detect a usable shell on the executor host. */
export function getExecutorShellPath(): string {
  if (cachedShellPath !== null) {
    return cachedShellPath;
  }

  if (process.platform === 'win32') {
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

  cachedShellPath = process.env.SHELL || '/bin/bash';
  return cachedShellPath;
}
