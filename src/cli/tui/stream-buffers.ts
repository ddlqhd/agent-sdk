import type { StreamEvent } from '../../core/types.js';

export interface TuiStreamBuffers {
  thinking: string;
  assistant: string;
}

export function createEmptyStreamBuffers(): TuiStreamBuffers {
  return { thinking: '', assistant: '' };
}

/** Accumulate thinking and assistant text from agent stream events. */
export function reduceStreamEvent(buffers: TuiStreamBuffers, event: StreamEvent): TuiStreamBuffers {
  switch (event.type) {
    case 'thinking':
      return { ...buffers, thinking: buffers.thinking + event.content };
    case 'text_delta':
      return { ...buffers, assistant: buffers.assistant + event.content };
    default:
      return buffers;
  }
}
