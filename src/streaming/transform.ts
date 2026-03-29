import type { StreamChunk, StreamEvent } from '../core/types.js';
import { AgentStream } from './event-emitter.js';
import { StreamChunkProcessor } from './chunk-processor.js';

/**
 * 流转换器
 * 将模型的 StreamChunk 转换为统一的 StreamEvent
 */
export class StreamTransformer {
  /**
   * 转换模型流为事件流
   */
  async *transform(chunks: AsyncIterable<StreamChunk>): AsyncIterable<StreamEvent> {
    const processor = new StreamChunkProcessor({ emitTextBoundaries: true });

    yield { type: 'start', timestamp: Date.now() };

    for await (const chunk of chunks) {
      const events = processor.processChunk(chunk);
      for (const event of events) {
        yield event;
      }
    }

    for (const event of processor.flush()) {
      yield event;
    }

    yield { type: 'end', usage: processor.getUsage(), timestamp: Date.now() };
  }
}

/**
 * 转换模型流为事件流
 */
export async function* transformStream(chunks: AsyncIterable<StreamChunk>): AsyncIterable<StreamEvent> {
  const transformer = new StreamTransformer();
  yield* transformer.transform(chunks);
}

/**
 * 将模型流转换为 AgentStream
 */
export function toAgentStream(chunks: AsyncIterable<StreamChunk>): AgentStream {
  const stream = new AgentStream();

  (async () => {
    try {
      for await (const event of transformStream(chunks)) {
        stream.push(event);
      }
      stream.end();
    } catch (error) {
      stream.throwError(error as Error);
    }
  })();

  return stream;
}

export { StreamChunkProcessor } from './chunk-processor.js';
export type { StreamChunkProcessorOptions } from './chunk-processor.js';
