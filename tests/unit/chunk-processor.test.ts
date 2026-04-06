import { describe, it, expect } from 'vitest';
import { StreamChunkProcessor } from '../../src/streaming/chunk-processor.js';
import { transformStream } from '../../src/streaming/transform.js';

describe('StreamChunkProcessor', () => {
  it('wraps text in text_start / text_end and emits tool_call_end before tool_call', () => {
    const p = new StreamChunkProcessor({ emitTextBoundaries: true });
    const out: string[] = [];
    const pushAll = (events: ReturnType<StreamChunkProcessor['processChunk']>) => {
      for (const e of events) out.push(e.type);
    };
    pushAll(p.processChunk({ type: 'text', content: 'Hi' }));
    pushAll(
      p.processChunk({
        type: 'tool_call',
        toolCall: { id: '1', name: 'Read', arguments: { path: '/' } }
      })
    );
    pushAll(p.flush());
    expect(out).toEqual(['text_start', 'text_delta', 'text_end', 'tool_call_end', 'tool_call']);
  });

  it('accepts Anthropic-style tool_call_start with toolCallId + name in content', () => {
    const p = new StreamChunkProcessor();
    const types: string[] = [];
    const take = (events: ReturnType<StreamChunkProcessor['processChunk']>) => {
      for (const e of events) types.push(e.type);
    };
    take(
      p.processChunk({
        type: 'tool_call_start',
        toolCallId: 'tu_1',
        content: 'Read'
      })
    );
    take(
      p.processChunk({
        type: 'tool_call_delta',
        toolCallId: 'tu_1',
        content: '{"path":"a"}'
      })
    );
    take(p.processChunk({ type: 'tool_call_end' }));
    take(p.flush());
    expect(types).toEqual(['tool_call_start', 'tool_call_delta', 'tool_call_end', 'tool_call']);
  });

  it('finalizes streaming tool when atomic tool_call matches id', () => {
    const p = new StreamChunkProcessor();
    const types: string[] = [];
    p.processChunk({
      type: 'tool_call_start',
      toolCallId: 'x',
      content: 'Bash'
    });
    p.processChunk({
      type: 'tool_call_delta',
      toolCallId: 'x',
      content: '{"cmd":"ls"}'
    });
    for (const e of p.processChunk({
      type: 'tool_call',
      toolCall: { id: 'x', name: 'Bash', arguments: { cmd: 'ls' } }
    })) {
      types.push(e.type);
    }
    expect(types).toEqual(['tool_call_end', 'tool_call']);
  });

  it('maps chunk error to terminal end with reason error', () => {
    const p = new StreamChunkProcessor();
    const events = p.processChunk({ type: 'error', error: new Error('fail') });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.type).toBe('end');
    if (e.type === 'end') {
      expect(e.reason).toBe('error');
      expect(e.error?.message).toBe('fail');
    }
  });

  it('does not emit text boundaries when emitTextBoundaries is false', () => {
    const p = new StreamChunkProcessor({ emitTextBoundaries: false });
    const types: string[] = [];
    for (const e of p.processChunk({ type: 'text', content: 'a' })) types.push(e.type);
    for (const e of p.flush()) types.push(e.type);
    expect(types).toEqual(['text_delta']);
  });
});

describe('transformStream', () => {
  it('flushes pending streamed tool call at end of chunk iterable', async () => {
    async function* chunks() {
      yield {
        type: 'tool_call_start' as const,
        toolCallId: 't1',
        content: 'Grep'
      };
      yield {
        type: 'tool_call_delta' as const,
        toolCallId: 't1',
        content: '{}'
      };
    }

    const types: string[] = [];
    for await (const e of transformStream(chunks())) {
      types.push(e.type);
    }
    expect(types).toContain('tool_call_start');
    expect(types).toContain('tool_call_delta');
    expect(types).toContain('tool_call_end');
    expect(types).toContain('tool_call');
    expect(types[0]).toBe('start');
    expect(types[types.length - 1]).toBe('end');
  });

  it('stops after chunk error without a trailing complete end', async () => {
    async function* chunks() {
      yield { type: 'error' as const, error: new Error('stream fail') };
    }

    const types: string[] = [];
    for await (const e of transformStream(chunks())) {
      types.push(e.type);
    }
    expect(types).toEqual(['start', 'end']);
  });
});
