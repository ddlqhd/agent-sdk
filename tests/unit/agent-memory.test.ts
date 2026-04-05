import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAgent, Agent } from '../../src/core/agent.js';
import { MemoryManager } from '../../src/memory/manager.js';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ModelAdapter, StreamChunk, MemoryConfig } from '../../src/core/types.js';

// Mock model adapter for testing
const createMockModel = (): ModelAdapter => ({
  name: 'mock-model',
  async *stream(): AsyncIterable<StreamChunk> {
    yield { type: 'text', content: 'Mock response' };
    yield { type: 'done' };
  },
  async complete() {
    return { content: 'Mock response' };
  }
});

describe('Agent Memory Integration', () => {
  let testWorkspaceDir: string;
  let testMemoryPath: string;

  beforeEach(() => {
    testWorkspaceDir = join(tmpdir(), `agent-sdk-test-${Date.now()}`);
    mkdirSync(testWorkspaceDir, { recursive: true });
    testMemoryPath = join(testWorkspaceDir, 'CLAUDE.md');
  });

  afterEach(() => {
    if (existsSync(testMemoryPath)) {
      unlinkSync(testMemoryPath);
    }
  });

  it('should load memory when memory is enabled (default)', () => {
    const memoryContent = '# Project Rules\n\nAlways use async/await';
    writeFileSync(testMemoryPath, memoryContent);

    const memoryConfig: MemoryConfig = {
      workspacePath: testMemoryPath
    };

    const manager = new MemoryManager(undefined, memoryConfig);
    const loadedMemory = manager.loadMemory();

    expect(loadedMemory).toContain('<system-minder>');
    expect(loadedMemory).toContain(memoryContent);
  });

  it('should respect memory config paths', () => {
    // Create custom memory file
    const customDir = join(tmpdir(), `agent-sdk-custom-${Date.now()}`);
    mkdirSync(customDir, { recursive: true });
    const customMemoryPath = join(customDir, 'custom-memory.md');
    const customContent = '# Custom Rules\n\nUse strict mode';
    writeFileSync(customMemoryPath, customContent);

    const config: MemoryConfig = {
      workspacePath: customMemoryPath
    };

    const manager = new MemoryManager(undefined, config);
    const memory = manager.loadMemory();

    expect(memory).toContain(customContent);

    // Cleanup
    unlinkSync(customMemoryPath);
  });

  it('should create agent with memory config', () => {
    const memoryContent = '# Test Memory';
    writeFileSync(testMemoryPath, memoryContent);

    const agent = createAgent({
      model: createMockModel(),
      memory: true,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      memoryConfig: {
        workspacePath: testMemoryPath
      }
    });

    expect(agent).toBeInstanceOf(Agent);
  });

  it('should create agent with memory disabled', () => {
    const agent = createAgent({
      model: createMockModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD
    });

    expect(agent).toBeInstanceOf(Agent);
  });

  it('should track memory loaded state via clearMessages', async () => {
    const memoryContent = '# Memory Content';
    writeFileSync(testMemoryPath, memoryContent);

    const agent = createAgent({
      model: createMockModel(),
      memory: true,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      memoryConfig: {
        workspacePath: testMemoryPath
      }
    });

    // First run - memory should be loaded
    await agent.run('Hello');

    // Get messages - memory should be a separate system message
    const messagesAfterFirstRun = agent.getMessages();
    const memoryMessage = messagesAfterFirstRun.find(
      m => m.role === 'system' && typeof m.content === 'string' && m.content.includes(memoryContent)
    );
    const firstUserMessage = messagesAfterFirstRun.find(m => m.role === 'user');
    
    expect(memoryMessage).toBeDefined();
    expect(firstUserMessage?.content).toBe('Hello'); // User message should not contain memory

    // Clear messages
    agent.clearMessages();

    // Run again - memory should be loaded again after clear
    await agent.run('Hello again');

    const messagesAfterClear = agent.getMessages();
    const memoryMessageAfterClear = messagesAfterClear.find(
      m => m.role === 'system' && typeof m.content === 'string' && m.content.includes(memoryContent)
    );
    const userMessageAfterClear = messagesAfterClear.find(m => m.role === 'user');
    
    expect(memoryMessageAfterClear).toBeDefined();
    expect(userMessageAfterClear?.content).toBe('Hello again');
  });

  it('should not load memory when disabled', async () => {
    const memoryContent = '# Memory Content';
    writeFileSync(testMemoryPath, memoryContent);

    const agent = createAgent({
      model: createMockModel(),
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      memoryConfig: {
        workspacePath: testMemoryPath
      }
    });

    await agent.run('Hello');

    const messages = agent.getMessages();
    const userMessage = messages.find(m => m.role === 'user');
    // Memory should NOT be prepended when disabled
    expect(userMessage?.content).toBe('Hello');
  });
});