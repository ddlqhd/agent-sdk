import { describe, it, expect } from 'vitest';
import { ToolRegistry, createTool } from '../../src/tools/registry.js';
import { createSkillRegistry } from '../../src/skills/registry.js';
import { z } from 'zod';

describe('ToolRegistry', () => {
  it('should register a tool', () => {
    const registry = new ToolRegistry();
    const tool = createTool({
      name: 'test_tool',
      description: 'A test tool',
      parameters: z.object({ input: z.string() }),
      handler: async ({ input }) => ({ content: `Result: ${input}` })
    });

    registry.register(tool);
    expect(registry.has('test_tool')).toBe(true);
    expect(registry.size).toBe(1);
  });

  it('should throw on duplicate registration', () => {
    const registry = new ToolRegistry();
    const tool = createTool({
      name: 'test_tool',
      description: 'A test tool',
      parameters: z.object({}),
      handler: async () => ({ content: 'ok' })
    });

    registry.register(tool);
    expect(() => registry.register(tool)).toThrow('already registered');
  });

  it('should unregister a tool', () => {
    const registry = new ToolRegistry();
    const tool = createTool({
      name: 'test_tool',
      description: 'A test tool',
      parameters: z.object({}),
      handler: async () => ({ content: 'ok' })
    });

    registry.register(tool);
    expect(registry.has('test_tool')).toBe(true);

    registry.unregister('test_tool');
    expect(registry.has('test_tool')).toBe(false);
  });

  it('should execute a tool', async () => {
    const registry = new ToolRegistry();
    const tool = createTool({
      name: 'add',
      description: 'Add two numbers',
      parameters: z.object({
        a: z.number(),
        b: z.number()
      }),
      handler: async ({ a, b }) => ({
        content: String(a + b)
      })
    });

    registry.register(tool);
    const result = await registry.execute('add', { a: 2, b: 3 });

    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('5');
  });

  it('should return error for unknown tool', async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute('unknown', {});

    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found');
  });

  it('should validate tool parameters', async () => {
    const registry = new ToolRegistry();
    const tool = createTool({
      name: 'strict_tool',
      description: 'A tool with strict parameters',
      parameters: z.object({
        required: z.string()
      }),
      handler: async ({ required }) => ({
        content: required
      })
    });

    registry.register(tool);

    // Invalid parameters
    const result = await registry.execute('strict_tool', { wrong: 'value' });
    expect(result.isError).toBe(true);
  });

  it('should get all tools', () => {
    const registry = new ToolRegistry();
    
    registry.register(createTool({
      name: 'tool1',
      description: 'Tool 1',
      parameters: z.object({}),
      handler: async () => ({ content: '1' })
    }));

    registry.register(createTool({
      name: 'tool2',
      description: 'Tool 2',
      parameters: z.object({}),
      handler: async () => ({ content: '2' })
    }));

    expect(registry.getAll()).toHaveLength(2);
    expect(registry.getNames()).toEqual(['tool1', 'tool2']);
  });

  it('should convert to schema', () => {
    const registry = new ToolRegistry();
    
    registry.register(createTool({
      name: 'test',
      description: 'Test tool',
      parameters: z.object({
        input: z.string().describe('Input value')
      }),
      handler: async () => ({ content: 'ok' })
    }));

    const schema = registry.toSchema();
    expect(schema).toHaveLength(1);
    expect(schema[0].name).toBe('test');
    expect(schema[0].parameters.type).toBe('object');
  });

  it('should support category field', () => {
    const registry = new ToolRegistry();
    const tool = createTool({
      name: 'categorized_tool',
      description: 'A tool with category',
      parameters: z.object({}),
      handler: async () => ({ content: 'ok' }),
      category: 'filesystem'
    });

    registry.register(tool);
    expect(registry.get('categorized_tool')?.category).toBe('filesystem');
  });

  it('should register tools with categories', () => {
    const registry = new ToolRegistry();
    const tool = createTool({
      name: 'cat_tool',
      description: 'Categorized',
      parameters: z.object({}),
      handler: async () => ({ content: 'ok' })
    });

    registry.registerWithCategory('shell', tool);
    expect(registry.getCategories()).toContain('shell');
    expect(registry.getByCategory('shell')).toHaveLength(1);
  });

  it('should filter tools', () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: 'tool_a',
      description: 'Tool A',
      parameters: z.object({}),
      handler: async () => ({ content: 'a' }),
      isDangerous: true
    }));
    registry.register(createTool({
      name: 'tool_b',
      description: 'Tool B',
      parameters: z.object({}),
      handler: async () => ({ content: 'b' }),
      isDangerous: false
    }));

    const dangerous = registry.filter(t => t.isDangerous);
    expect(dangerous).toHaveLength(1);
    expect(dangerous[0].name).toBe('tool_a');
  });

  it('should search tools by name or description', () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: 'read_file',
      description: 'Read file contents',
      parameters: z.object({}),
      handler: async () => ({ content: 'ok' })
    }));
    registry.register(createTool({
      name: 'write_file',
      description: 'Write to a file',
      parameters: z.object({}),
      handler: async () => ({ content: 'ok' })
    }));

    const results = registry.search('read');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('read_file');
  });

  it('should export tool configs', () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: 'test',
      description: 'Test',
      parameters: z.object({ key: z.string() }),
      handler: async () => ({ content: 'ok' })
    }));

    const exported = registry.export();
    expect(exported).toHaveLength(1);
    expect(exported[0].name).toBe('test');
    expect(exported[0].parameters).toBeDefined();
  });
});

describe('Builtin Tools', () => {
  it('should provide all builtin tools', async () => {
    const { getAllBuiltinTools } = await import('../../src/tools/builtin/index.js');
    const skillRegistry = createSkillRegistry();
    const tools = getAllBuiltinTools(skillRegistry);
    const names = tools.map(t => t.name);

    // Core tools should be present
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('edit');
    expect(names).toContain('glob');
    expect(names).toContain('grep');
    expect(names).toContain('list_directory');
    expect(names).toContain('bash');
    expect(names).toContain('web_fetch');
    expect(names).toContain('web_search');
    expect(names).toContain('http_request');
    expect(names).toContain('download_file');
    expect(names).toContain('todo_write');
    expect(names).toContain('question');
    expect(names).toContain('delete_file');
  });

  it('should filter safe tools (no dangerous)', async () => {
    const { getSafeBuiltinTools } = await import('../../src/tools/builtin/index.js');
    const skillRegistry = createSkillRegistry();
    const tools = getSafeBuiltinTools(skillRegistry);
    const dangerous = tools.filter(t => t.isDangerous);

    expect(dangerous).toHaveLength(0);
  });

});

describe('Read File Tool', () => {
  it('should read a file with line numbers', async () => {
    const { readFileTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `test_read_${Date.now()}.txt`);
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(tmpFile, 'line1\nline2\nline3', 'utf-8');

    const result = await registry.execute('read_file', { path: tmpFile });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('line1');
    expect(result.content).toContain('line2');
    expect(result.content).toContain('End of file');

    await fs.unlink(tmpFile).catch(() => {});
  });

  it('should truncate long lines', async () => {
    const { readFileTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `test_read_long_${Date.now()}.txt`);
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });

    const longLine = 'a'.repeat(3000);
    await fs.writeFile(tmpFile, longLine, 'utf-8');

    const result = await registry.execute('read_file', { path: tmpFile });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('line truncated to 2000 chars');
    expect(result.content.length).toBeLessThan(3000);

    await fs.unlink(tmpFile).catch(() => {});
  });

  it('should respect offset and limit parameters', async () => {
    const { readFileTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `test_read_offset_${Date.now()}.txt`);
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(tmpFile, 'line1\nline2\nline3\nline4\nline5', 'utf-8');

    const result = await registry.execute('read_file', {
      path: tmpFile,
      offset: 2,
      limit: 2
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('line2');
    expect(result.content).toContain('line3');
    expect(result.content).not.toContain('line1');
    expect(result.content).not.toContain('line4');
    expect(result.content).toContain('Showing lines 2-3');

    await fs.unlink(tmpFile).catch(() => {});
  });
});

describe('Edit Tool', () => {
  it('should reject same old_string and new_string', async () => {
    const { editTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(editTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `test_edit_${Date.now()}.txt`);
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(tmpFile, 'hello world', 'utf-8');

    const result = await registry.execute('edit', {
      file_path: tmpFile,
      old_string: 'same',
      new_string: 'same'
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('must be different');

    await fs.unlink(tmpFile).catch(() => {});
  });

  it('should edit a file with exact string replacement', async () => {
    const { editTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(editTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `test_edit_${Date.now()}.txt`);
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(tmpFile, 'hello world', 'utf-8');

    const result = await registry.execute('edit', {
      file_path: tmpFile,
      old_string: 'world',
      new_string: 'universe'
    });

    expect(result.isError).toBeFalsy();
    const content = await fs.readFile(tmpFile, 'utf-8');
    expect(content).toBe('hello universe');

    await fs.unlink(tmpFile).catch(() => {});
  });
});

describe('Todo Tool', () => {
  it('should validate exactly one in_progress task', async () => {
    const { todoWriteTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(todoWriteTool);

    // Zero in_progress
    const result1 = await registry.execute('todo_write', {
      todos: [
        { content: 'Task 1', activeForm: 'Doing task 1', status: 'pending' }
      ]
    });
    expect(result1.isError).toBe(true);
    expect(result1.content).toContain('Expected exactly 1');

    // Two in_progress
    const result2 = await registry.execute('todo_write', {
      todos: [
        { content: 'Task 1', activeForm: 'Doing task 1', status: 'in_progress' },
        { content: 'Task 2', activeForm: 'Doing task 2', status: 'in_progress' }
      ]
    });
    expect(result2.isError).toBe(true);
  });

  it('should accept valid todo list', async () => {
    const { todoWriteTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(todoWriteTool);

    const result = await registry.execute('todo_write', {
      todos: [
        { content: 'Task 1', activeForm: 'Doing task 1', status: 'completed' },
        { content: 'Task 2', activeForm: 'Doing task 2', status: 'in_progress' },
        { content: 'Task 3', activeForm: 'Doing task 3', status: 'pending' }
      ]
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('completed');
    expect(result.content).toContain('in progress');
    expect(result.content).toContain('pending');
  });
});

describe('Question Tool', () => {
  it('should format question with options', async () => {
    const { questionTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(questionTool);

    const result = await registry.execute('question', {
      question: 'What framework do you prefer?',
      header: 'Framework',
      options: [
        { label: 'React', description: 'Meta UI library' },
        { label: 'Vue', description: 'Progressive framework' }
      ]
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('React');
    expect(result.content).toContain('Vue');
    expect(result.metadata).toBeDefined();
  });
});
