import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { MemoryConfig, SDKLogSink } from '../core/types.js';
import { emitSDKLog } from '../core/logger.js';

/**
 * MemoryManager handles the loading of long-term memory files
 * (CLAUDE.md) from user home directory and workspace root.
 */
export class MemoryManager {
  private workspaceRoot: string;
  private userBasePath: string;
  private config: MemoryConfig;
  private readonly sdkLog?: SDKLogSink;

  constructor(
    workspaceRoot?: string,
    config?: MemoryConfig,
    userBasePath?: string,
    sdkLog?: SDKLogSink
  ) {
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.userBasePath = userBasePath || homedir();
    this.config = config || {};
    this.sdkLog = sdkLog;
  }

  /**
   * Loads memory content from both user home ({userBasePath}/.claude/CLAUDE.md)
   * and workspace root (./CLAUDE.md).
   * @returns Combined memory content wrapped in system-minder tags
   */
  loadMemory(): string {
    const memories: string[] = [];

    // 1. Load user home memory ({userBasePath}/.claude/CLAUDE.md)
    const userPath = join(this.userBasePath, '.claude', 'CLAUDE.md');
    if (existsSync(userPath)) {
      try {
        const content = readFileSync(userPath, 'utf-8');
        if (content.trim()) {
          memories.push(`# User Memory\n\n${content}`);
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        emitSDKLog({
          logger: this.sdkLog?.logger,
          logLevel: this.sdkLog?.logLevel,
          redaction: this.sdkLog?.redaction,
          level: 'warn',
          event: {
            component: 'memory',
            event: 'memory.file.read.error',
            message: 'Failed reading user CLAUDE.md memory file',
            cwd: this.workspaceRoot,
            errorName: err.name,
            errorMessage: err.message,
            metadata: { kind: 'user', path: userPath }
          }
        });
      }
    }

    // 2. Load workspace memory (./CLAUDE.md)
    const workspacePath = this.config.workspacePath || join(this.workspaceRoot, 'CLAUDE.md');
    if (existsSync(workspacePath)) {
      try {
        const content = readFileSync(workspacePath, 'utf-8');
        if (content.trim()) {
          memories.push(`# Workspace Memory\n\n${content}`);
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        emitSDKLog({
          logger: this.sdkLog?.logger,
          logLevel: this.sdkLog?.logLevel,
          redaction: this.sdkLog?.redaction,
          level: 'warn',
          event: {
            component: 'memory',
            event: 'memory.file.read.error',
            message: 'Failed reading workspace CLAUDE.md memory file',
            cwd: this.workspaceRoot,
            errorName: err.name,
            errorMessage: err.message,
            metadata: { kind: 'workspace', path: workspacePath }
          }
        });
      }
    }

    if (memories.length === 0) {
      return '';
    }

    // Wrap content in system-minder tags as requested
    const combinedContent = memories.join('\n\n');
    return `<system-minder>\n${combinedContent}\n</system-minder>`;
  }

  /**
   * Checks if memory files exist.
   * @returns Object indicating existence of each memory file type
   */
  checkMemoryFiles(): { userHome: boolean; workspace: boolean } {
    const userPath = join(this.userBasePath, '.claude', 'CLAUDE.md');
    const workspacePath = this.config.workspacePath || join(this.workspaceRoot, 'CLAUDE.md');

    return {
      userHome: existsSync(userPath),
      workspace: existsSync(workspacePath)
    };
  }
}
