import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

    const dangerous = registry.filter(t => t.isDangerous === true);
    expect(dangerous).toHaveLength(1);
    expect(dangerous[0].name).toBe('tool_a');
  });

  it('should search tools by name or description', () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: 'Read',
      description: 'Read file contents',
      parameters: z.object({}),
      handler: async () => ({ content: 'ok' })
    }));
    registry.register(createTool({
      name: 'Write',
      description: 'Write to a file',
      parameters: z.object({}),
      handler: async () => ({ content: 'ok' })
    }));

    const results = registry.search('read');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Read');
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
    expect(names).toContain('Read');
    expect(names).toContain('Write');
    expect(names).toContain('Edit');
    expect(names).toContain('Glob');
    expect(names).toContain('Grep');
    expect(names).toContain('Bash');
    expect(names).toContain('WebFetch');
    expect(names).toContain('WebSearch');
    expect(names).toContain('TodoWrite');
    expect(names).toContain('AskUserQuestion');
    expect(names).toContain('Agent');

    // Removed tools should not be present
    expect(names).not.toContain('DeleteFile');
    expect(names).not.toContain('list_directory');
    expect(names).not.toContain('http_request');
    expect(names).not.toContain('download_file');
    expect(names).not.toContain('TaskCreate');
    expect(names).not.toContain('TaskUpdate');
    expect(names).not.toContain('TaskList');
  });

  it('should filter safe tools (no dangerous)', async () => {
    const { getSafeBuiltinTools } = await import('../../src/tools/builtin/index.js');
    const skillRegistry = createSkillRegistry();
    const tools = getSafeBuiltinTools(skillRegistry);
    const dangerous = tools.filter(t => t.isDangerous);

    expect(dangerous).toHaveLength(0);
  });
});

describe('Read Tool', () => {
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

    const result = await registry.execute('Read', { file_path: tmpFile });

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

    const result = await registry.execute('Read', { file_path: tmpFile });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('line truncated to 2000 chars');
    expect(result.content.length).toBeLessThan(3000);

    await fs.unlink(tmpFile).catch(() => {});
  });

  it('should decode GBK-encoded files when encoding is gbk', async () => {
    const { readFileTool } = await import('../../src/tools/builtin/index.js');
    const iconv = (await import('iconv-lite')).default;
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `test_read_gbk_${Date.now()}.txt`);
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    const gbkBuf = iconv.encode('第一行\n第二行测试', 'gbk');
    await fs.writeFile(tmpFile, gbkBuf);

    const result = await registry.execute('Read', {
      file_path: tmpFile,
      encoding: 'gbk'
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('第一行');
    expect(result.content).toContain('第二行测试');
    expect(result.content).toContain('End of file');

    await fs.unlink(tmpFile).catch(() => {});
  });

  it('should auto-detect GBK-encoded files when encoding is omitted', async () => {
    const { readFileTool } = await import('../../src/tools/builtin/index.js');
    const iconv = (await import('iconv-lite')).default;
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `test_read_gbk_auto_${Date.now()}.txt`);
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    const gbkBuf = iconv.encode('第一行\n第二行测试', 'gbk');
    await fs.writeFile(tmpFile, gbkBuf);

    const result = await registry.execute('Read', { file_path: tmpFile });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('第一行');
    expect(result.content).toContain('第二行测试');
    expect(result.content).toMatch(/Auto-detected encoding: gb18030/i);
    expect(result.content).toContain('End of file');

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

    const result = await registry.execute('Read', {
      file_path: tmpFile,
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

  it('should succeed for an empty file with zero lines (not an error)', async () => {
    const { readFileTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `test_read_empty_${Date.now()}.txt`);
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(tmpFile, '', 'utf-8');

    const result = await registry.execute('Read', { file_path: tmpFile });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('End of file - total 0 lines');
    expect(result.content).not.toMatch(/^Error:/m);

    await fs.unlink(tmpFile).catch(() => {});
  });
});

describe('Write Tool', () => {
  it('should write GBK-encoded file when encoding is gbk', async () => {
    const { writeFileTool } = await import('../../src/tools/builtin/index.js');
    const iconv = (await import('iconv-lite')).default;
    const registry = new ToolRegistry();
    registry.register(writeFileTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `test_write_gbk_${Date.now()}.txt`);
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });

    const text = '你好\n第二行';
    const result = await registry.execute('Write', {
      file_path: tmpFile,
      content: text,
      encoding: 'gbk'
    });

    expect(result.isError).toBeFalsy();
    const buf = await fs.readFile(tmpFile);
    expect(iconv.decode(buf, 'gbk')).toBe(text);

    await fs.unlink(tmpFile).catch(() => {});
  });

  it('should reject unsupported encoding', async () => {
    const { writeFileTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(writeFileTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `test_write_bad_enc_${Date.now()}.txt`);

    const result = await registry.execute('Write', {
      file_path: tmpFile,
      content: 'x',
      encoding: 'not-a-real-encoding-xyz'
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('unsupported encoding');

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

    const result = await registry.execute('Edit', {
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

    const result = await registry.execute('Edit', {
      file_path: tmpFile,
      old_string: 'world',
      new_string: 'universe'
    });

    expect(result.isError).toBeFalsy();
    const content = await fs.readFile(tmpFile, 'utf-8');
    expect(content).toBe('hello universe');

    await fs.unlink(tmpFile).catch(() => {});
  });

  it('should edit GBK-encoded file when encoding is gbk', async () => {
    const { editTool } = await import('../../src/tools/builtin/index.js');
    const iconv = (await import('iconv-lite')).default;
    const registry = new ToolRegistry();
    registry.register(editTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `test_edit_gbk_${Date.now()}.txt`);
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    const original = '第一行\n第二行';
    await fs.writeFile(tmpFile, iconv.encode(original, 'gbk'));

    const result = await registry.execute('Edit', {
      file_path: tmpFile,
      old_string: '第二行',
      new_string: '已改',
      encoding: 'gbk'
    });

    expect(result.isError).toBeFalsy();
    const buf = await fs.readFile(tmpFile);
    expect(iconv.decode(buf, 'gbk')).toBe('第一行\n已改');

    await fs.unlink(tmpFile).catch(() => {});
  });

  it('should reject empty old_string', async () => {
    const { editTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(editTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `test_edit_empty_${Date.now()}.txt`);
    await fs.writeFile(tmpFile, 'x', 'utf-8');

    const result = await registry.execute('Edit', {
      file_path: tmpFile,
      old_string: '',
      new_string: 'y'
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/Invalid arguments/i);

    await fs.unlink(tmpFile).catch(() => {});
  });

  it('should match LF old_string in CRLF file and keep CRLF', async () => {
    const { editTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(editTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `test_edit_crlf_${Date.now()}.txt`);
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(tmpFile, 'a\r\nb\r\n', 'utf-8');

    const result = await registry.execute('Edit', {
      file_path: tmpFile,
      old_string: 'a\nb',
      new_string: 'x\ny'
    });

    expect(result.isError).toBeFalsy();
    const content = await fs.readFile(tmpFile, 'utf-8');
    expect(content).toBe('x\r\ny\r\n');

    await fs.unlink(tmpFile).catch(() => {});
  });

  it('should reject when path is not a regular file', async () => {
    const { editTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(editTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpDir = path.join(os.tmpdir(), `test_edit_notfile_${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    const result = await registry.execute('Edit', {
      file_path: tmpDir,
      old_string: 'x',
      new_string: 'y'
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('is not a file');

    await fs.rm(tmpDir, { recursive: true }).catch(() => {});
  });

  it('should match CR-only line breaks in old_string when file uses LF', async () => {
    const { editTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(editTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `test_edit_cr_${Date.now()}.txt`);
    await fs.writeFile(tmpFile, 'a\nb\n', 'utf-8');

    const result = await registry.execute('Edit', {
      file_path: tmpFile,
      old_string: 'a\rb',
      new_string: 'ok'
    });

    expect(result.isError).toBeFalsy();
    const content = await fs.readFile(tmpFile, 'utf-8');
    expect(content).toBe('ok\n');

    await fs.unlink(tmpFile).catch(() => {});
  });
});

describe('TodoWrite Tool', () => {
  it('should write a structured todo list', async () => {
    const { todoWriteTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(todoWriteTool);

    const result = await registry.execute('TodoWrite', {
      todos: [
        { content: 'Inspect code', activeForm: 'Inspecting code', status: 'completed' },
        { content: 'Update tests', activeForm: 'Updating tests', status: 'in_progress' },
        { content: 'Summarize changes', activeForm: 'Summarizing changes', status: 'pending' }
      ]
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Task list updated');
    expect(result.content).toContain('[x] Inspect code');
    expect(result.content).toContain('[>] Update tests');
    expect(result.metadata).toMatchObject({
      todos: [
        { content: 'Inspect code', activeForm: 'Inspecting code', status: 'completed' },
        { content: 'Update tests', activeForm: 'Updating tests', status: 'in_progress' },
        { content: 'Summarize changes', activeForm: 'Summarizing changes', status: 'pending' }
      ]
    });
  });

  it('should accept todos without activeForm', async () => {
    const { todoWriteTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(todoWriteTool);

    const result = await registry.execute('TodoWrite', {
      todos: [{ content: 'Only content', status: 'completed' }]
    });

    expect(result.isError).toBeFalsy();
    expect(result.metadata).toMatchObject({
      todos: [{ content: 'Only content', status: 'completed' }]
    });
  });

  it('should accept all pending (no in_progress yet)', async () => {
    const { todoWriteTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(todoWriteTool);

    const result = await registry.execute('TodoWrite', {
      todos: [
        { content: 'First step', activeForm: 'Doing first step', status: 'pending' },
        { content: 'Second step', activeForm: 'Doing second step', status: 'pending' }
      ]
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('0 in progress');
  });

  it('should accept all completed (no in_progress)', async () => {
    const { todoWriteTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(todoWriteTool);

    const result = await registry.execute('TodoWrite', {
      todos: [
        { content: 'Done A', activeForm: 'Doing A', status: 'completed' },
        { content: 'Done B', activeForm: 'Doing B', status: 'completed' }
      ]
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('2 completed');
    expect(result.content).toContain('0 in progress');
  });

  it('should accept multiple in_progress (parallel work)', async () => {
    const { todoWriteTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(todoWriteTool);

    const result = await registry.execute('TodoWrite', {
      todos: [
        { content: 'A', activeForm: 'Doing A', status: 'in_progress' },
        { content: 'B', activeForm: 'Doing B', status: 'in_progress' },
        { content: 'C', activeForm: 'Doing C', status: 'pending' }
      ]
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('2 in progress');
    expect(result.content).toContain('[>] A');
    expect(result.content).toContain('[>] B');
  });
});

describe('AskUserQuestion Tool', () => {
  it('should format questions with options', async () => {
    const { questionTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(questionTool);

    const result = await registry.execute('AskUserQuestion', {
      questions: [
        {
          question: 'What framework do you prefer?',
          header: 'Framework',
          options: [
            { label: 'React', description: 'Meta UI library' },
            { label: 'Vue', description: 'Progressive framework' }
          ],
          multiSelect: false
        }
      ]
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('React');
    expect(result.content).toContain('Vue');
    expect(result.metadata).toBeDefined();
  });
});

describe('AskUserQuestion interactive (injected resolve)', () => {
  const twoOptions = {
    question: 'Pick one?',
    header: 'Pick',
    options: [
      { label: 'Alpha', description: 'a' },
      { label: 'Beta', description: 'b' }
    ],
    multiSelect: false as const
  };

  it('should record single selection and include answers in metadata', async () => {
    const { createAskUserQuestionTool } = await import('../../src/tools/builtin/interaction.js');
    const tool = createAskUserQuestionTool({
      resolve: async () => [{ questionIndex: 0, selectedLabels: ['Alpha'] }]
    });
    const registry = new ToolRegistry();
    registry.register(tool);

    const result = await registry.execute('AskUserQuestion', { questions: [twoOptions] });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('--- User responses ---');
    expect(result.content).toContain('Alpha');
    expect(result.metadata).toMatchObject({
      questions: [twoOptions],
      answers: [{ questionIndex: 0, selectedLabels: ['Alpha'] }]
    });
  });

  it('should record Other with custom text', async () => {
    const { createAskUserQuestionTool } = await import('../../src/tools/builtin/interaction.js');
    const tool = createAskUserQuestionTool({
      resolve: async () => [{ questionIndex: 0, selectedLabels: [], otherText: 'custom reply' }]
    });
    const registry = new ToolRegistry();
    registry.register(tool);

    const result = await registry.execute('AskUserQuestion', { questions: [twoOptions] });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Other: custom reply');
    expect(result.metadata).toMatchObject({
      answers: [{ questionIndex: 0, selectedLabels: [], otherText: 'custom reply' }]
    });
  });

  it('should record multi-select', async () => {
    const { createAskUserQuestionTool } = await import('../../src/tools/builtin/interaction.js');
    const q = {
      question: 'Pick many?',
      header: 'Multi',
      options: [
        { label: 'X', description: 'x' },
        { label: 'Y', description: 'y' },
        { label: 'Z', description: 'z' }
      ],
      multiSelect: true
    };
    const tool = createAskUserQuestionTool({
      resolve: async () => [{ questionIndex: 0, selectedLabels: ['X', 'Z'] }]
    });
    const registry = new ToolRegistry();
    registry.register(tool);

    const result = await registry.execute('AskUserQuestion', { questions: [q] });

    expect(result.isError).toBeFalsy();
    expect(result.metadata).toMatchObject({
      answers: [{ questionIndex: 0, selectedLabels: ['X', 'Z'] }]
    });
  });

  it('should return isError when resolve throws', async () => {
    const { createAskUserQuestionTool } = await import('../../src/tools/builtin/interaction.js');
    const tool = createAskUserQuestionTool({
      resolve: async () => {
        throw new Error('user dismissed');
      }
    });
    const registry = new ToolRegistry();
    registry.register(tool);

    const result = await registry.execute('AskUserQuestion', {
      questions: [
        {
          question: 'Q?',
          header: 'H',
          options: [
            { label: 'A', description: 'a' },
            { label: 'B', description: 'b' }
          ],
          multiSelect: false
        }
      ]
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('AskUserQuestion failed');
    expect(result.content).toContain('user dismissed');
  });
});

describe('Agent Tool', () => {
  it('should validate required prompt field', async () => {
    const { agentTool } = await import('../../src/tools/builtin/subagent.js');
    const registry = new ToolRegistry();
    registry.register(agentTool);

    const result = await registry.execute('Agent', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid arguments');
  });

  it('should return configured error when runner is missing', async () => {
    const { agentTool } = await import('../../src/tools/builtin/subagent.js');
    const registry = new ToolRegistry();
    registry.register(agentTool);

    const result = await registry.execute('Agent', {
      prompt: 'run task'
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not configured');
  });
});

describe('Builtin Tools cwd inheritance', () => {
  it('Glob should default to projectDir and allow explicit path override', async () => {
    const { globTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(globTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    const projectDir = path.join(os.tmpdir(), `test_glob_project_${Date.now()}`);
    const overrideDir = path.join(os.tmpdir(), `test_glob_override_${Date.now()}`);
    const projectHit = path.join(projectDir, 'src', 'project-hit.ts');
    const overrideHit = path.join(overrideDir, 'src', 'override-hit.ts');

    await fs.mkdir(path.dirname(projectHit), { recursive: true });
    await fs.mkdir(path.dirname(overrideHit), { recursive: true });
    await fs.writeFile(projectHit, 'project', 'utf-8');
    await fs.writeFile(overrideHit, 'override', 'utf-8');

    try {
      const defaultResult = await registry.execute(
        'Glob',
        { pattern: '**/*.ts' },
        { projectDir }
      );
      expect(defaultResult.isError).toBeFalsy();
      expect(defaultResult.content).toContain(projectHit);
      expect(defaultResult.content).not.toContain(overrideHit);

      const overrideResult = await registry.execute(
        'Glob',
        { pattern: '**/*.ts', path: overrideDir },
        { projectDir }
      );
      expect(overrideResult.isError).toBeFalsy();
      expect(overrideResult.content).toContain(overrideHit);
      expect(overrideResult.content).not.toContain(projectHit);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
      await fs.rm(overrideDir, { recursive: true, force: true });
    }
  });

  it('Glob **/* should match files at search root (regression)', async () => {
    const { globTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(globTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    const projectDir = path.join(os.tmpdir(), `test_glob_star_root_${Date.now()}`);
    const rootFile = path.join(projectDir, 'CLAUDE.md');
    const nestedFile = path.join(projectDir, 'src', 'nested.ts');

    await fs.mkdir(path.dirname(nestedFile), { recursive: true });
    await fs.writeFile(rootFile, 'root', 'utf-8');
    await fs.writeFile(nestedFile, 'nested', 'utf-8');

    try {
      const result = await registry.execute('Glob', { pattern: '**/*' }, { projectDir });
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain(rootFile);
      expect(result.content).toContain(nestedFile);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Glob should skip dotfiles by default but match when pattern targets them', async () => {
    const { globTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(globTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    const projectDir = path.join(os.tmpdir(), `test_glob_dot_${Date.now()}`);
    const visible = path.join(projectDir, 'visible.txt');
    const dotfile = path.join(projectDir, '.secret.json');

    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(visible, 'v', 'utf-8');
    await fs.writeFile(dotfile, '{}', 'utf-8');

    try {
      const wide = await registry.execute('Glob', { pattern: '**/*' }, { projectDir });
      expect(wide.isError).toBeFalsy();
      expect(wide.content).toContain(visible);
      expect(wide.content).not.toContain(dotfile);

      const targeted = await registry.execute(
        'Glob',
        { pattern: '**/.secret.json' },
        { projectDir }
      );
      expect(targeted.isError).toBeFalsy();
      expect(targeted.content).toContain(dotfile);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Glob should accept Windows backslash patterns by normalizing separators', async () => {
    const { globTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(globTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    const projectDir = path.join(os.tmpdir(), `test_glob_backslash_${Date.now()}`);
    const nestedFile = path.join(projectDir, 'src', 'windows-match.ts');

    await fs.mkdir(path.dirname(nestedFile), { recursive: true });
    await fs.writeFile(nestedFile, 'ok', 'utf-8');

    try {
      const result = await registry.execute(
        'Glob',
        { pattern: 'src\\**\\*.ts' },
        { projectDir }
      );
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain(nestedFile);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Grep should default to projectDir and allow explicit path override', async () => {
    const { grepTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(grepTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    const projectDir = path.join(os.tmpdir(), `test_grep_project_${Date.now()}`);
    const overrideDir = path.join(os.tmpdir(), `test_grep_override_${Date.now()}`);
    const projectFile = path.join(projectDir, 'project.txt');
    const overrideFile = path.join(overrideDir, 'override.txt');

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(overrideDir, { recursive: true });
    await fs.writeFile(projectFile, 'project_token', 'utf-8');
    await fs.writeFile(overrideFile, 'override_token', 'utf-8');

    try {
      const defaultResult = await registry.execute(
        'Grep',
        { pattern: 'project_token' },
        { projectDir }
      );
      expect(defaultResult.isError).toBeFalsy();
      expect(defaultResult.content).toContain('project.txt:1:project_token');
      expect(defaultResult.content).not.toContain('override.txt');

      const overrideResult = await registry.execute(
        'Grep',
        { pattern: 'override_token', path: overrideDir },
        { projectDir }
      );
      expect(overrideResult.isError).toBeFalsy();
      expect(overrideResult.content).toContain('override.txt:1:override_token');
      expect(overrideResult.content).not.toContain('project.txt');
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
      await fs.rm(overrideDir, { recursive: true, force: true });
    }
  });

  it('truncateMatchLineForDisplay keeps match when match is late in a long line', async () => {
    const { truncateMatchLineForDisplay, MAX_LINE_LENGTH } = await import('../../src/tools/builtin/grep.js');
    const line = `${'x'.repeat(3000)}FINDME${'y'.repeat(500)}`;
    const out = truncateMatchLineForDisplay(line, /FINDME/);
    expect(out).toContain('FINDME');
    expect(out.length).toBeLessThanOrEqual(MAX_LINE_LENGTH + 6);
  });

  it('Grep should respect head_limit', async () => {
    const { grepTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(grepTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    const projectDir = path.join(os.tmpdir(), `test_grep_head_${Date.now()}`);
    await fs.mkdir(projectDir, { recursive: true });
    const body = Array.from({ length: 10 }, (_, i) => `line_${i}`).join('\n');
    await fs.writeFile(path.join(projectDir, 'many.txt'), body, 'utf-8');

    try {
      const result = await registry.execute(
        'Grep',
        { pattern: 'line_', path: projectDir, head_limit: 3 },
        { projectDir }
      );
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('(Showing first 3 matches)');
      expect(result.content?.split('\n').filter((l) => l.includes('line_')).length).toBeLessThanOrEqual(3);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Grep glob should support brace expansion', async () => {
    const { grepTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(grepTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    const projectDir = path.join(os.tmpdir(), `test_grep_brace_${Date.now()}`);
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, 'a.ts'), 'TOKEN', 'utf-8');
    await fs.writeFile(path.join(projectDir, 'b.tsx'), 'TOKEN', 'utf-8');
    await fs.writeFile(path.join(projectDir, 'c.txt'), 'TOKEN', 'utf-8');

    try {
      const result = await registry.execute(
        'Grep',
        { pattern: 'TOKEN', path: projectDir, glob: '*.{ts,tsx}' },
        { projectDir }
      );
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('a.ts');
      expect(result.content).toContain('b.tsx');
      expect(result.content).not.toContain('c.txt');
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Grep should skip paths ignored by root .gitignore', async () => {
    const { grepTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(grepTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    const projectDir = path.join(os.tmpdir(), `test_grep_gitignore_${Date.now()}`);
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, '.gitignore'), 'ignored.txt\n', 'utf-8');
    await fs.writeFile(path.join(projectDir, 'tracked.txt'), 'TRACKED_ONLY', 'utf-8');
    await fs.writeFile(path.join(projectDir, 'ignored.txt'), 'IGNORED_ONLY', 'utf-8');

    try {
      const result = await registry.execute('Grep', { pattern: 'ONLY', path: projectDir }, { projectDir });
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('TRACKED_ONLY');
      expect(result.content).not.toContain('IGNORED_ONLY');
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Grep should reject single file when glob does not match', async () => {
    const { grepTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(grepTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    const projectDir = path.join(os.tmpdir(), `test_grep_glob_file_${Date.now()}`);
    await fs.mkdir(projectDir, { recursive: true });
    const filePath = path.join(projectDir, 'readme.txt');
    await fs.writeFile(filePath, 'secret', 'utf-8');

    try {
      const result = await registry.execute(
        'Grep',
        { pattern: 'secret', path: filePath, glob: '*.md' },
        { projectDir }
      );
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('No matches found (path does not match glob filter)');
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Grep should include far-right match in long line output', async () => {
    const { grepTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(grepTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    const projectDir = path.join(os.tmpdir(), `test_grep_long_${Date.now()}`);
    await fs.mkdir(projectDir, { recursive: true });
    const longLine = `${'z'.repeat(3200)}HIT_END`;
    await fs.writeFile(path.join(projectDir, 'wide.txt'), longLine, 'utf-8');

    try {
      const result = await registry.execute(
        'Grep',
        { pattern: 'HIT_END', path: projectDir },
        { projectDir }
      );
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('HIT_END');
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('Bash should default to projectDir and allow explicit cwd override', async () => {
    const { bashTool } = await import('../../src/tools/builtin/index.js');
    const registry = new ToolRegistry();
    registry.register(bashTool);

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    const projectDir = path.join(os.tmpdir(), `test_bash_project_${Date.now()}`);
    const overrideDir = path.join(os.tmpdir(), `test_bash_override_${Date.now()}`);
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(overrideDir, { recursive: true });

    const normalize = (value: string) => value.trim().replace(/\\/g, '/').toLowerCase();

    try {
      const defaultResult = await registry.execute(
        'Bash',
        { command: 'node -e "console.log(process.cwd())"' },
        { projectDir }
      );
      expect(defaultResult.isError).toBeFalsy();
      expect(normalize(defaultResult.content)).toContain(normalize(projectDir));

      const overrideResult = await registry.execute(
        'Bash',
        { command: 'node -e "console.log(process.cwd())"', cwd: overrideDir },
        { projectDir }
      );
      expect(overrideResult.isError).toBeFalsy();
      expect(normalize(overrideResult.content)).toContain(normalize(overrideDir));
      expect(normalize(overrideResult.content)).not.toContain(normalize(projectDir));
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
      await fs.rm(overrideDir, { recursive: true, force: true });
    }
  });
});

describe('Schema Conversion', () => {
  it('should include additionalProperties: false for objects', () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: 'test',
      description: 'Test',
      parameters: z.object({
        name: z.string().describe('A name'),
        count: z.number().optional()
      }),
      handler: async () => ({ content: 'ok' })
    }));

    const schema = registry.toSchema();
    expect(schema[0].parameters.additionalProperties).toBe(false);
  });

  it('should convert number constraints', () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: 'test',
      description: 'Test',
      parameters: z.object({
        count: z.number().int().min(1).max(100)
      }),
      handler: async () => ({ content: 'ok' })
    }));

    const schema = registry.toSchema();
    const countProp = (schema[0].parameters.properties as any).count;
    expect(countProp.type).toBe('integer');
    expect(countProp.minimum).toBe(1);
    expect(countProp.maximum).toBe(100);
  });

  it('should convert default values', () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: 'test',
      description: 'Test',
      parameters: z.object({
        flag: z.boolean().default(false)
      }),
      handler: async () => ({ content: 'ok' })
    }));

    const schema = registry.toSchema();
    const flagProp = (schema[0].parameters.properties as any).flag;
    expect(flagProp.type).toBe('boolean');
    expect(flagProp.default).toBe(false);
  });

  it('should convert array constraints', () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: 'test',
      description: 'Test',
      parameters: z.object({
        items: z.array(z.string()).min(1).max(4)
      }),
      handler: async () => ({ content: 'ok' })
    }));

    const schema = registry.toSchema();
    const itemsProp = (schema[0].parameters.properties as any).items;
    expect(itemsProp.type).toBe('array');
    expect(itemsProp.minItems).toBe(1);
    expect(itemsProp.maxItems).toBe(4);
  });

  it('should convert string constraints', () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: 'test',
      description: 'Test',
      parameters: z.object({
        query: z.string().min(2)
      }),
      handler: async () => ({ content: 'ok' })
    }));

    const schema = registry.toSchema();
    const queryProp = (schema[0].parameters.properties as any).query;
    expect(queryProp.type).toBe('string');
    expect(queryProp.minLength).toBe(2);
  });

  it('should preserve description through optional wrapper', () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: 'test',
      description: 'Test',
      parameters: z.object({
        path: z.string().describe('The path').optional()
      }),
      handler: async () => ({ content: 'ok' })
    }));

    const schema = registry.toSchema();
    const pathProp = (schema[0].parameters.properties as any).path;
    expect(pathProp.description).toBe('The path');
  });

  it('should preserve description through default wrapper', () => {
    const registry = new ToolRegistry();
    registry.register(createTool({
      name: 'test',
      description: 'Test',
      parameters: z.object({
        flag: z.boolean().describe('Enable feature').default(true)
      }),
      handler: async () => ({ content: 'ok' })
    }));

    const schema = registry.toSchema();
    const flagProp = (schema[0].parameters.properties as any).flag;
    expect(flagProp.description).toBe('Enable feature');
    expect(flagProp.default).toBe(true);
  });
});
