import { describe, it, expect } from 'vitest';
import { createStreamFormatter, formatEvent } from '../../src/cli/utils/output.js';

function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('createStreamFormatter', () => {
  it('non-verbose: tool call on tool_call event, result on tool_result event', () => {
    const f = createStreamFormatter({ verbose: false });
    const callOut = f.format({
      type: 'tool_call',
      id: 'tc1',
      name: 'Read',
      arguments: { path: '/a' }
    });
    const callPlain = stripAnsi(callOut);
    expect(callPlain).toContain('🔧 Read');
    expect(callPlain).toContain('[tc1]');
    expect(callPlain).not.toContain('✓');

    const resultOut = f.format({ type: 'tool_result', toolCallId: 'tc1', result: 'ok' });
    const resultPlain = stripAnsi(resultOut);
    expect(resultPlain).toContain('✓');
    expect(resultPlain).toContain('[tc1]');
    expect(resultPlain).toContain('ok');
    expect(resultPlain).not.toContain('🔧');
  });

  it('non-verbose: tool call on tool_call event, error on tool_error event', () => {
    const f = createStreamFormatter({ verbose: false });
    const callOut = f.format({ type: 'tool_call', id: 'tc1', name: 'Read', arguments: {} });
    expect(stripAnsi(callOut)).toContain('🔧 Read');
    expect(stripAnsi(callOut)).not.toContain('✗');

    const errOut = f.format({
      type: 'tool_error',
      toolCallId: 'tc1',
      error: new Error('failed')
    });
    const errPlain = stripAnsi(errOut);
    expect(errPlain).toContain('✗');
    expect(errPlain).toContain('[tc1]');
    expect(errPlain).toContain('failed');
    expect(errPlain).not.toContain('🔧');
  });

  it('verbose: invocation on tool_call, result body on tool_result', () => {
    const f = createStreamFormatter({ verbose: true });
    const callOut = f.format({
      type: 'tool_call',
      id: 'tc1',
      name: 'Read',
      arguments: { path: '/x' }
    });
    const callPlain = stripAnsi(callOut);
    expect(callPlain).toContain('🔧 Read');
    expect(callPlain).toContain('[tc1]');
    expect(callPlain).toContain('"path"');
    expect(callPlain).not.toContain('Result:');

    const resultOut = f.format({ type: 'tool_result', toolCallId: 'tc1', result: 'ok' });
    const resultPlain = stripAnsi(resultOut);
    expect(resultPlain).toContain('[tc1]');
    expect(resultPlain).toContain('Result:');
    expect(resultPlain).toContain('ok');
    expect(resultPlain).not.toContain('🔧');
  });

  it('non-verbose: parallel calls show full toolCallId in tag', () => {
    const f = createStreamFormatter({ verbose: false });
    const longIdA = 'toolu_01ABCDEFGHIJ';
    const longIdB = 'toolu_02KLMNOPQRSTU';
    f.format({
      type: 'tool_call',
      id: longIdA,
      name: 'Read',
      arguments: { path: '/a' }
    });
    f.format({
      type: 'tool_call',
      id: longIdB,
      name: 'Read',
      arguments: { path: '/b' }
    });
    const outA = stripAnsi(
      f.format({ type: 'tool_result', toolCallId: longIdA, result: 'content-a' })
    );
    const outB = stripAnsi(
      f.format({ type: 'tool_result', toolCallId: longIdB, result: 'content-b' })
    );
    expect(outA).toContain(`[${longIdA}]`);
    expect(outA).toContain('content-a');
    expect(outB).toContain(`[${longIdB}]`);
    expect(outB).toContain('content-b');
  });

  it('inserts newline before assistant text after tool result', () => {
    const f = createStreamFormatter({ verbose: false });
    f.format({ type: 'tool_call', id: 'tc1', name: 'Read', arguments: {} });
    f.format({ type: 'tool_result', toolCallId: 'tc1', result: 'done' });
    const out = f.format({ type: 'text_delta', content: 'Hello' });
    expect(stripAnsi(out)).toBe('\nHello');
  });

  it('inserts newline before assistant text when model_usage is between tool result and text', () => {
    const f = createStreamFormatter({ verbose: false });
    f.format({ type: 'tool_call', id: 'tc1', name: 'Read', arguments: {} });
    f.format({ type: 'tool_result', toolCallId: 'tc1', result: 'done' });
    f.format({
      type: 'model_usage',
      usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 }
    });
    const out = f.format({ type: 'text_delta', content: 'Hello' });
    expect(stripAnsi(out)).toBe('\nHello');
  });

  it('inserts newline before assistant text after tool error', () => {
    const f = createStreamFormatter({ verbose: false });
    f.format({ type: 'tool_call', id: 'tc1', name: 'Read', arguments: {} });
    f.format({
      type: 'tool_error',
      toolCallId: 'tc1',
      error: new Error('x')
    });
    const out = f.format({ type: 'text_delta', content: 'Next' });
    expect(stripAnsi(out)).toBe('\nNext');
  });

  it('prints fatal stream error and abort on end.reason', () => {
    const f = createStreamFormatter({ verbose: false });
    expect(stripAnsi(f.format({ type: 'end', timestamp: 0, reason: 'error', error: new Error('boom') }))).toContain(
      'boom'
    );
    expect(stripAnsi(f.format({ type: 'end', timestamp: 0, reason: 'aborted' }))).toContain('[interrupted]');
  });

  it('formatEvent mirrors end.reason for error and aborted', () => {
    expect(stripAnsi(formatEvent({ type: 'end', timestamp: 0, reason: 'error', error: new Error('e') }))).toContain(
      'e'
    );
    expect(stripAnsi(formatEvent({ type: 'end', timestamp: 0, reason: 'aborted' }))).toContain('[interrupted]');
  });

  it('formatEvent prints max_iterations notice', () => {
    expect(
      stripAnsi(formatEvent({ type: 'end', timestamp: 0, reason: 'max_iterations' }))
    ).toContain('maxIterations');
  });
});
