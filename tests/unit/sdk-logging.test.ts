import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Agent } from '../../src/core/agent.js';
import { formatSDKLog, resolveLogRedaction, sanitizeForLogging } from '../../src/core/logger.js';
import type { LogEvent, ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { OpenAIAdapter } from '../../src/models/openai.js';
import { createTool } from '../../src/tools/index.js';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

function createCaptureLogger(events: LogEvent[]) {
  return {
    debug(event: LogEvent) {
      events.push(event);
    },
    info(event: LogEvent) {
      events.push(event);
    },
    warn(event: LogEvent) {
      events.push(event);
    },
    error(event: LogEvent) {
      events.push(event);
    }
  };
}

describe('SDK logging helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('formats logs with SDK prefix and key fields', () => {
    const formatted = formatSDKLog({
      source: 'agent-sdk',
      component: 'model',
      event: 'model.request.start',
      message: 'Starting model request',
      provider: 'openai',
      model: 'gpt-4o-mini',
      sessionId: 'sess-1',
      durationMs: 25
    });

    expect(formatted).toContain('[agent-sdk][model][model.request.start]');
    expect(formatted).toContain('provider=openai');
    expect(formatted).toContain('model=gpt-4o-mini');
    expect(formatted).toContain('sessionId=sess-1');
  });

  it('redacts sensitive headers, messages, and tool arguments by default', () => {
    const redaction = resolveLogRedaction();
    const sanitized = sanitizeForLogging({
      authorization: 'Bearer secret',
      messages: [{ role: 'user', content: 'hello world' }],
      arguments: { city: 'Shanghai' },
      nested: {
        token: 'abc123'
      }
    }, redaction) as Record<string, unknown>;

    expect(sanitized.authorization).toBe('[REDACTED]');
    expect(sanitized.messages).toBe('[REDACTED_MESSAGES:1]');
    expect(sanitized.arguments).toBe('[REDACTED_TOOL_ARGUMENTS]');
    expect((sanitized.nested as Record<string, unknown>).token).toBe('[REDACTED]');
  });

  it('uses the new body logging env var for body capture defaults', () => {
    delete process.env.AGENT_SDK_LOG_BODIES;
    expect(resolveLogRedaction().includeBodies).toBe(false);

    process.env.AGENT_SDK_LOG_BODIES = 'true';
    expect(resolveLogRedaction().includeBodies).toBe(true);

    delete process.env.AGENT_SDK_LOG_BODIES;
  });
});

describe('SDK logging integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('emits agent lifecycle and tool execution logs', async () => {
    let callCount = 0;
    const model: ModelAdapter = {
      name: 'test-model',
      async *stream(_params: ModelParams): AsyncIterable<StreamChunk> {
        callCount += 1;
        if (callCount === 1) {
          yield {
            type: 'tool_call',
            toolCall: {
              id: 'tool-1',
              name: 'echo_tool',
              arguments: { text: 'hello' }
            }
          };
          yield { type: 'done' };
          return;
        }

        yield { type: 'text', content: 'done' };
        yield { type: 'done' };
      },
      async complete() {
        return { content: 'done' };
      }
    };

    const logs: LogEvent[] = [];
    const echoTool = createTool({
      name: 'echo_tool',
      description: 'Echo the text back',
      parameters: z.object({
        text: z.string()
      }),
      handler: async ({ text }) => ({
        content: String(text)
      })
    });

    const agent = new Agent({
      model,
      logger: createCaptureLogger(logs),
      logLevel: 'debug',
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [echoTool],
      storage: { type: 'memory' }
    });

    await agent.waitForInit();
    const result = await agent.run('hello');

    expect(result.content).toBe('done');
    expect(logs.some(event => event.event === 'agent.run.start')).toBe(true);
    expect(logs.some(event => event.event === 'agent.iteration.start')).toBe(true);
    expect(logs.some(event => event.event === 'tool.call.start')).toBe(true);
    expect(logs.some(event => event.event === 'tool.call.end')).toBe(true);
    expect(logs.some(event => event.event === 'agent.run.end')).toBe(true);
  });

  it('emits provider request logs and records provider request ids', async () => {
    const logs: LogEvent[] = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'x-request-id': 'req-123'
      }),
      json: async () => ({
        choices: [
          {
            message: {
              content: 'ok'
            }
          }
        ],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 5
        }
      })
    }));

    const adapter = new OpenAIAdapter({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini'
    });

    const result = await adapter.complete({
      messages: [{ role: 'user', content: 'hello' }],
      logger: createCaptureLogger(logs),
      logLevel: 'info'
    });

    expect(result.content).toBe('ok');
    const start = logs.find(event => event.event === 'model.request.start');
    const end = logs.find(event => event.event === 'model.request.end');
    expect(start).toBeDefined();
    expect(end?.requestId).toBe('req-123');
    expect((start?.metadata as Record<string, unknown>).requestBody).toBeUndefined();
    expect((start?.metadata as Record<string, unknown>).messageCount).toBe(1);
  });
});
