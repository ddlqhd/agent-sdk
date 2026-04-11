import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import { createTool } from '../../src/tools/registry.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { z } from 'zod';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

const textOnlyModel: ModelAdapter = {
  name: 'callback-test-model',
  async *stream(_params: ModelParams): AsyncIterable<StreamChunk> {
    yield { type: 'text', content: 'hello' };
    yield { type: 'done' };
  },
  async complete() {
    return { content: 'hello' };
  }
};

describe('Agent lifecycle callbacks', () => {
  it('invokes core observation hooks on a simple turn without tools', async () => {
    const onRunStart = vi.fn();
    const onSystemMessage = vi.fn();
    const onUserMessage = vi.fn();
    const onModelRequestStart = vi.fn();
    const onModelRequestEnd = vi.fn();
    const onAssistantMessage = vi.fn();
    const onIterationStart = vi.fn();
    const onIterationEnd = vi.fn();
    const onRunEnd = vi.fn();
    const onMessagePersist = vi.fn();
    const onEvent = vi.fn();

    const agent = new Agent({
      model: textOnlyModel,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      callbacks: {
        onEvent,
        lifecycle: {
          onRunStart,
          onSystemMessage,
          onUserMessage,
          onModelRequestStart,
          onModelRequestEnd,
          onAssistantMessage,
          onIterationStart,
          onIterationEnd,
          onRunEnd,
          onMessagePersist
        }
      }
    });

    await agent.waitForInit();
    await agent.run('ping');

    expect(onRunStart).toHaveBeenCalledTimes(1);
    expect(onSystemMessage).toHaveBeenCalled();
    expect(onUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: 'ping' }),
      'raw_input',
      expect.anything()
    );
    expect(onModelRequestStart).toHaveBeenCalledTimes(1);
    expect(onModelRequestEnd).toHaveBeenCalledTimes(1);
    expect(onAssistantMessage).toHaveBeenCalledTimes(1);
    expect(onIterationStart).toHaveBeenCalledTimes(1);
    expect(onIterationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ hadToolCalls: false, iteration: 0 })
    );
    expect(onMessagePersist).toHaveBeenCalled();
    expect(onRunEnd).toHaveBeenCalledWith(expect.objectContaining({ reason: 'complete' }));
    expect(onEvent).toHaveBeenCalled();
  });

  it('invokes tool-related lifecycle hooks when the model requests a tool', async () => {
    const ping = createTool({
      name: 'Ping',
      description: 'p',
      parameters: z.object({}),
      handler: async () => ({ content: 'pong' })
    });

    const modelWithTool: ModelAdapter = {
      name: 'callback-tool-model',
      async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
        const last = params.messages[params.messages.length - 1];
        if (last?.role === 'user') {
          yield {
            type: 'tool_call',
            toolCall: { id: 'tc-ping', name: 'Ping', arguments: {} }
          };
          yield { type: 'done' };
          return;
        }
        yield { type: 'text', content: 'after-tool' };
        yield { type: 'done' };
      },
      async complete() {
        return { content: 'x' };
      }
    };

    const onToolCallPlanned = vi.fn();
    const onToolExecutionStart = vi.fn();
    const onToolExecutionEnd = vi.fn();
    const onToolResult = vi.fn();
    const onToolMessage = vi.fn();

    const agent = new Agent({
      model: modelWithTool,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      tools: [ping],
      callbacks: {
        lifecycle: {
          onToolCallPlanned,
          onToolExecutionStart,
          onToolExecutionEnd,
          onToolResult,
          onToolMessage
        }
      }
    });

    await agent.waitForInit();
    await agent.run('go');

    expect(onToolCallPlanned).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ping', id: 'tc-ping' }),
      expect.objectContaining({ iteration: 0 })
    );
    expect(onToolExecutionStart).toHaveBeenCalledTimes(1);
    expect(onToolExecutionEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'Ping',
        toolCallId: 'tc-ping',
        isError: false
      })
    );
    expect(onToolResult).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'Ping',
        result: expect.objectContaining({ content: 'pong' })
      })
    );
    expect(onToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'tool', toolCallId: 'tc-ping' }),
      expect.objectContaining({ iteration: 0, toolCallId: 'tc-ping' })
    );
  });
});
