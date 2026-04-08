import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';

const { statMock } = vi.hoisted(() => ({
  statMock: vi.fn()
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    stat: (...args: Parameters<typeof actual.stat>) => statMock(...args) as ReturnType<typeof actual.stat>
  };
});

describe('Edit Tool max file size', () => {
  beforeEach(() => {
    statMock.mockReset();
  });

  it('rejects edit when stat reports size at 1 GiB', async () => {
    statMock.mockResolvedValue({
      size: 1024 ** 3,
      isFile: () => true
    });

    const fs = await import('fs/promises');
    const readSpy = vi.spyOn(fs, 'readFile');

    try {
      const { editTool } = await import('../../src/tools/builtin/filesystem.js');
      const registry = new ToolRegistry();
      registry.register(editTool);

      const os = await import('os');
      const path = await import('path');
      const tmpFile = path.join(os.tmpdir(), `test_edit_huge_${Date.now()}.txt`);

      const result = await registry.execute('Edit', {
        file_path: tmpFile,
        old_string: 'a',
        new_string: 'b'
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('1 GiB');
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
    }
  });
});
