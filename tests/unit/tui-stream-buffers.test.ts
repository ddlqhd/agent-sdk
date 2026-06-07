import { describe, it, expect } from 'vitest';
import {
  createEmptyStreamBuffers,
  reduceStreamEvent
} from '../../src/cli/tui/stream-buffers.js';

describe('reduceStreamEvent', () => {
  it('accumulates thinking then assistant text', () => {
    let buf = createEmptyStreamBuffers();
    buf = reduceStreamEvent(buf, { type: 'thinking', content: 'hmm ' });
    buf = reduceStreamEvent(buf, { type: 'thinking', content: 'ok' });
    buf = reduceStreamEvent(buf, { type: 'text_delta', content: 'Hi' });
    expect(buf).toEqual({ thinking: 'hmm ok', assistant: 'Hi' });
  });

  it('ignores unrelated events', () => {
    const buf = reduceStreamEvent(createEmptyStreamBuffers(), {
      type: 'tool_call',
      id: '1',
      name: 'Read',
      arguments: {}
    });
    expect(buf).toEqual({ thinking: '', assistant: '' });
  });
});
