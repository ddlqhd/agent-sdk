import type { StreamEvent, TokenUsage } from '../core/types.js';

/**
 * Agent 流类
 * 实现 AsyncIterable 接口，支持 for await...of 遍历
 */
export class AgentStream implements AsyncIterable<StreamEvent> {
  private events: StreamEvent[] = [];
  private resolvers: Array<{
    resolve: (value: IteratorResult<StreamEvent>) => void;
    reject: (error: Error) => void;
  }> = [];
  private isEnded = false;
  private error: Error | null = null;
  private abortController: AbortController;

  constructor() {
    this.abortController = new AbortController();
  }

  /**
   * 实现 AsyncIterable 接口
   */
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    return {
      next: async (): Promise<IteratorResult<StreamEvent>> => {
        // 检查是否中止
        if (this.abortController.signal.aborted) {
          return { done: true, value: undefined };
        }

        // 检查是否有错误
        if (this.error) {
          throw this.error;
        }

        // 检查是否有缓存事件
        if (this.events.length > 0) {
          const event = this.events.shift()!;
          return { done: false, value: event };
        }

        // 检查是否已结束
        if (this.isEnded) {
          return { done: true, value: undefined };
        }

        // 等待新事件
        return new Promise((resolve, reject) => {
          this.resolvers.push({ resolve, reject });
        });
      }
    };
  }

  /**
   * 推送事件
   */
  push(event: StreamEvent): void {
    if (this.error) return;

    // 如果有等待的 resolver，直接 resolve
    if (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!;
      resolver.resolve({ done: false, value: event });
    } else {
      // 否则缓存事件
      this.events.push(event);
    }
  }

  /**
   * 结束流
   */
  end(usage?: TokenUsage): void {
    if (usage) {
      this.push({ type: 'model_usage', usage });
    }

    this.push({ type: 'end', timestamp: Date.now() });

    this.isEnded = true;

    // resolve 所有等待的 resolver
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!;
      resolver.resolve({ done: true, value: undefined });
    }
  }

  /**
   * 抛出错误
   */
  throwError(error: Error): void {
    this.error = error;

    // reject 所有等待的 resolver
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!;
      resolver.reject(error);
    }
  }

  /**
   * 中止流
   */
  abort(): void {
    this.abortController.abort();
    this.isEnded = true;

    // resolve 所有等待的 resolver
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!;
      resolver.resolve({ done: true, value: undefined });
    }
  }

  /**
   * 获取中止信号
   */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * 合并多个流
   */
  static merge(...streams: AgentStream[]): AgentStream {
    const merged = new AgentStream();
    let completedCount = 0;

    for (const stream of streams) {
      (async () => {
        try {
          for await (const event of stream) {
            merged.push(event);
          }
        } catch (error) {
          merged.throwError(error as Error);
        } finally {
          completedCount++;
          if (completedCount === streams.length) {
            merged.end();
          }
        }
      })();
    }

    return merged;
  }

  /**
   * 转换为数组
   */
  async toArray(): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    for await (const event of this) {
      events.push(event);
    }
    return events;
  }

  /**
   * 收集文本内容
   */
  async collectText(): Promise<string> {
    let text = '';
    for await (const event of this) {
      if (event.type === 'text_delta') {
        text += event.content;
      }
    }
    return text;
  }

  /**
   * 过滤事件
   */
  filter(predicate: (event: StreamEvent) => boolean): AgentStream {
    const filtered = new AgentStream();

    (async () => {
      try {
        for await (const event of this) {
          if (predicate(event)) {
            filtered.push(event);
          }
        }
        filtered.end();
      } catch (error) {
        filtered.throwError(error as Error);
      }
    })();

    return filtered;
  }

  /**
   * 转换事件
   */
  map<T>(transform: (event: StreamEvent) => T): AsyncIterable<T> {
    const self = this;

    return {
      async *[Symbol.asyncIterator]() {
        for await (const event of self) {
          yield transform(event);
        }
      }
    };
  }
}

/**
 * 创建 Agent 流
 */
export function createStream(): AgentStream {
  return new AgentStream();
}

/**
 * 从 AsyncIterable 创建 Agent 流
 */
export function fromAsyncIterable(iterable: AsyncIterable<StreamEvent>): AgentStream {
  const stream = new AgentStream();

  (async () => {
    try {
      for await (const event of iterable) {
        stream.push(event);
      }
      stream.end();
    } catch (error) {
      stream.throwError(error as Error);
    }
  })();

  return stream;
}
