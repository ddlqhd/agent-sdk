import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../../packages/agent-sdk/src/tools/registry.js';
import { createLocalEnvironment } from '@ddlqhd/agent-sdk-exec';
import { editTool } from '../../packages/agent-sdk/src/tools/builtin/filesystem.js';

describe('Edit Tool max file size', () => {
  it('rejects edit when stat reports size at 1 GiB', async () => {
    const base = createLocalEnvironment();
    const readText = vi.fn();
    const environment = {
      ...base,
      fs: {
        ...base.fs,
        stat: async () => ({
          isFile: true,
          isDirectory: false,
          size: 1024 ** 3,
          mtimeMs: 0
        }),
        readText
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
    expect(readText).not.toHaveBeenCalled();
  });
});
