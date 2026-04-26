import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { TOOL_USER_ABORTED_MESSAGE } from '../../src/core/abort-constants.js';
import { ToolRegistry, createTool } from '../../src/tools/registry.js';
import {
  createAskUserQuestionTool,
  type AskUserQuestionItem
} from '../../src/tools/builtin/interaction.js';
import type { ToolExecutionContext } from '../../src/core/types.js';
import { runInteractiveAskUserQuestion } from '../../src/cli/utils/ask-user-question.js';

describe('ToolRegistry + abort signal', () => {
  it('skips handler when signal is already aborted (after param validation)', async () => {
    const handler = vi.fn(async () => ({ content: 'should not run' }));
    const registry = new ToolRegistry();
    registry.register(
      createTool({
        name: 'slow',
        description: 'x',
        parameters: z.object({ x: z.string() }),
        handler
      })
    );

    const ac = new AbortController();
    ac.abort();
    const result = await registry.execute('slow', { x: 'a' }, { signal: ac.signal });

    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toBe(TOOL_USER_ABORTED_MESSAGE);
  });

  it('passes signal in ToolExecutionContext to handler', async () => {
    const registry = new ToolRegistry();
    const handler = vi.fn(async (_args, ctx) => {
      expect(ctx?.signal).toBeDefined();
      expect(ctx?.signal?.aborted).toBe(false);
      return { content: 'ok' };
    });
    registry.register(
      createTool({
        name: 'sig',
        description: 'x',
        parameters: z.object({}),
        handler
      })
    );
    const ac = new AbortController();
    await registry.execute('sig', {}, { signal: ac.signal });
    expect(handler).toHaveBeenCalled();
  });
});

describe('AskUserQuestion + signal', () => {
  it('returns error when context.signal is aborted before resolve', async () => {
    const resolve = vi.fn();
    const tool = createAskUserQuestionTool({ resolve });
    const ac = new AbortController();
    ac.abort();
    const questions: AskUserQuestionItem[] = [
      {
        question: 'Test?',
        header: 'H',
        options: [
          { label: 'A', description: 'a' },
          { label: 'B', description: 'b' }
        ],
        multiSelect: false
      }
    ];
    const result = await tool.handler({ questions }, { signal: ac.signal } as ToolExecutionContext);

    expect(resolve).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });
});

describe('runInteractiveAskUserQuestion', () => {
  it('rejects with AbortError when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const readLine = async () => '1';
    await expect(
      runInteractiveAskUserQuestion(
        [
          {
            question: 'Q?',
            header: 'H',
            options: [
              { label: 'A', description: 'a' },
              { label: 'B', description: 'b' }
            ],
            multiSelect: false
          }
        ],
        readLine,
        { signal: ac.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
