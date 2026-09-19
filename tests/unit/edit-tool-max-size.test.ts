import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../../packages/agent-sdk/src/tools/registry.js';
import { createLocalEnvironment } from '@ddlqhd/agent-sdk-exec';
import { editTool } from '../../packages/agent-sdk/src/tools/builtin/filesystem.js';

describe('Edit Tool max file size', () => {
  it('rejects edit when execution plane reports a 1 GiB file', async () => {
    const base = createLocalEnvironment();
    const environment = {
      ...base,
      fs: {
        ...base.fs,
        edit: async () => {
          throw new Error(
            'Error: file is too large to edit (1073741824 bytes). Maximum size is 1073741824 bytes (1 GiB). Use a different tool or split the work.'
          );
        }
      }
    };

    const registry = new ToolRegistry();
    registry.register(editTool);

    const result = await registry.execute(
      'Edit',
      {
        file_path: '/tmp/test_edit_huge.txt',
        old_string: 'a',
        new_string: 'b'
      },
      { environment }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('1 GiB');
  });

  it('LocalFileSystem.edit rejects before reading when stat is 1 GiB', async () => {
    const env = createLocalEnvironment();
    const stat = vi.spyOn(env.fs, 'stat').mockResolvedValue({
      isFile: true,
      isDirectory: false,
      size: 1024 ** 3,
      mtimeMs: 0
    });
    const readText = vi.spyOn(env.fs, 'readText');

    await expect(env.fs.edit('/tmp/huge.txt', { oldString: 'a', newString: 'b' })).rejects.toThrow(
      /1 GiB/
    );
    expect(readText).not.toHaveBeenCalled();
    stat.mockRestore();
    readText.mockRestore();
  });
});
