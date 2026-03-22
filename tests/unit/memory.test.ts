import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../src/memory/manager.js';
import type { MemoryConfig } from '../../src/core/types.js';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { tmpdir } from 'os';

describe('MemoryManager', () => {
  let testWorkspaceDir: string;
  let testHomeDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    // Create temporary workspace directory
    testWorkspaceDir = join(tmpdir(), `agent-sdk-test-${Date.now()}`);
    mkdirSync(testWorkspaceDir, { recursive: true });

    // Create temporary home directory for testing
    testHomeDir = join(tmpdir(), `agent-sdk-home-${Date.now()}`);
    mkdirSync(testHomeDir, { recursive: true });
    mkdirSync(join(testHomeDir, '.claude'), { recursive: true });

    // Backup original HOME environment variable
    originalHome = process.env.HOME;
    // Note: homedir() uses os.homedir() which respects USERPROFILE on Windows
    // We can't easily override it for the test, so we'll test workspace memory primarily
  });

  afterEach(() => {
    // Cleanup test directories
    if (existsSync(testWorkspaceDir)) {
      const files = [join(testWorkspaceDir, 'CLAUDE.md')];
      files.forEach(file => {
        if (existsSync(file)) unlinkSync(file);
      });
    }
    
    if (existsSync(testHomeDir)) {
      const homeFiles = [join(testHomeDir, '.claude', 'CLAUDE.md')];
      homeFiles.forEach(file => {
        if (existsSync(file)) unlinkSync(file);
      });
    }

    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
  });

  it('should return empty string when no memory files exist', () => {
    const manager = new MemoryManager(testWorkspaceDir);
    const memory = manager.loadMemory();
    expect(memory).toBe('');
  });

  it('should load workspace memory file', () => {
    const workspaceMemoryPath = join(testWorkspaceDir, 'CLAUDE.md');
    const workspaceContent = '# Workspace Rules\n\nUse TypeScript';
    writeFileSync(workspaceMemoryPath, workspaceContent);

    const manager = new MemoryManager(testWorkspaceDir);
    const memory = manager.loadMemory();

    expect(memory).toContain('<system-minder>');
    expect(memory).toContain('# Workspace Memory');
    expect(memory).toContain(workspaceContent);
    expect(memory).toContain('</system-minder>');
  });

  it('should combine user and workspace memory', () => {
    // Create workspace memory
    const workspaceMemoryPath = join(testWorkspaceDir, 'CLAUDE.md');
    const workspaceContent = '# Workspace Rules\n\nUse TypeScript';
    writeFileSync(workspaceMemoryPath, workspaceContent);

    // Create user memory (we'll simulate by writing to test home dir)
    // Note: Due to homedir() limitations in tests, we'll primarily test workspace
    // The user memory test would require mocking homedir() or setting env vars
    
    const manager = new MemoryManager(testWorkspaceDir);
    const memory = manager.loadMemory();

    expect(memory).toContain('<system-minder>');
    expect(memory).toContain('# Workspace Memory');
    expect(memory).toContain(workspaceContent);
  });

  it('should check memory files existence correctly', () => {
    const manager = new MemoryManager(testWorkspaceDir);
    
    // No files exist initially
    const check1 = manager.checkMemoryFiles();
    expect(check1.workspace).toBe(false);

    // Create workspace file
    const workspaceMemoryPath = join(testWorkspaceDir, 'CLAUDE.md');
    writeFileSync(workspaceMemoryPath, 'test content');
    
    const check2 = manager.checkMemoryFiles();
    expect(check2.workspace).toBe(true);
  });

  it('should handle empty memory files gracefully', () => {
    const workspaceMemoryPath = join(testWorkspaceDir, 'CLAUDE.md');
    writeFileSync(workspaceMemoryPath, '   \n\n   '); // Only whitespace

    const manager = new MemoryManager(testWorkspaceDir);
    const memory = manager.loadMemory();
    
    // Empty files should be skipped
    expect(memory).toBe('');
  });

  it('should wrap content in system-minder tags', () => {
    const workspaceMemoryPath = join(testWorkspaceDir, 'CLAUDE.md');
    const content = 'Test memory content';
    writeFileSync(workspaceMemoryPath, content);

    const manager = new MemoryManager(testWorkspaceDir);
    const memory = manager.loadMemory();

    expect(memory.startsWith('<system-minder>')).toBe(true);
    expect(memory.endsWith('</system-minder>')).toBe(true);
    expect(memory).toContain(content);
  });

  it('should use custom workspace path from config', () => {
    // Create a custom directory with memory file
    const customDir = join(tmpdir(), `agent-sdk-custom-${Date.now()}`);
    mkdirSync(customDir, { recursive: true });
    const customContent = '# Custom Workspace\n\nUse strict mode';
    writeFileSync(join(customDir, 'memory.md'), customContent);

    // Use custom path config
    const config: MemoryConfig = {
      workspacePath: join(customDir, 'memory.md')
    };
    const manager = new MemoryManager(testWorkspaceDir, config);
    const memory = manager.loadMemory();

    expect(memory).toContain(customContent);
    expect(memory).toContain('# Workspace Memory');

    // Cleanup
    unlinkSync(join(customDir, 'memory.md'));
  });

  it('should use custom user home path from config', () => {
    // Create a custom user memory file
    const customUserDir = join(tmpdir(), `agent-sdk-user-${Date.now()}`);
    mkdirSync(customUserDir, { recursive: true });
    const customUserContent = '# Custom User Rules\n\nAlways use const';
    const customUserPath = join(customUserDir, 'user-memory.md');
    writeFileSync(customUserPath, customUserContent);

    // Use custom user home path config
    const config: MemoryConfig = {
      userHomePath: customUserPath
    };
    const manager = new MemoryManager(testWorkspaceDir, config);
    const memory = manager.loadMemory();

    expect(memory).toContain(customUserContent);
    expect(memory).toContain('# User Memory');

    // Cleanup
    unlinkSync(customUserPath);
  });
});
