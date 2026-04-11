import { describe, it, expect } from 'vitest';
import {
  isModelStreamEventType,
  MODEL_STREAM_EVENT_TYPES
} from '../../src/core/types.js';

describe('isModelStreamEventType / MODEL_STREAM_EVENT_TYPES', () => {
  it('returns true for every listed model stream type', () => {
    for (const t of MODEL_STREAM_EVENT_TYPES) {
      expect(isModelStreamEventType(t)).toBe(true);
    }
  });

  it('returns false for non-model stream boundary types', () => {
    expect(isModelStreamEventType('start')).toBe(false);
    expect(isModelStreamEventType('end')).toBe(false);
    expect(isModelStreamEventType('tool_result')).toBe(false);
    expect(isModelStreamEventType('tool_error')).toBe(false);
    expect(isModelStreamEventType('session_summary')).toBe(false);
    expect(isModelStreamEventType('context_compressed')).toBe(false);
  });
});
