// Streaming module
export { AgentStream, createStream, fromAsyncIterable } from './event-emitter.js';
export {
  StreamTransformer,
  transformStream,
  toAgentStream,
  StreamChunkProcessor
} from './transform.js';
export type { StreamChunkProcessorOptions } from './transform.js';
