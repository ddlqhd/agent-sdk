import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { MemoryConfig } from '../core/types.js';

/**
 * MemoryManager handles the loading of long-term memory files
 * (CLAUDE.md) from user home directory and workspace root.
 */
export class MemoryManager {
  private workspaceRoot: string;
  private config: MemoryConfig;

  constructor(workspaceRoot?: string, config?: MemoryConfig) {
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.config = config || {};
  }

  /**
   * Loads memory content from both user home (~/.claude/CLAUDE.md)
   * and workspace root (./CLAUDE.md).
   * @returns Combined memory content wrapped in system-minder tags
   */
  loadMemory(): string {
    const memories: string[] = [];

    // 1. Load user home memory (~/.claude/CLAUDE.md)
    const userHomePath = this.config.userHomePath || join(homedir(), '.claude', 'CLAUDE.md');
    if (existsSync(userHomePath)) {
      try {
        const content = readFileSync(userHomePath, 'utf-8');
        if (content.trim()) {
          memories.push(`# User Memory\n\n${content}`);
        }
      } catch (error) {
        console.error(`Error reading user memory file: ${error}`);
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
        console.error(`Error reading workspace memory file: ${error}`);
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
    const userHomePath = this.config.userHomePath || join(homedir(), '.claude', 'CLAUDE.md');
    const workspacePath = this.config.workspacePath || join(this.workspaceRoot, 'CLAUDE.md');

    return {
      userHome: existsSync(userHomePath),
      workspace: existsSync(workspacePath)
    };
  }
}
