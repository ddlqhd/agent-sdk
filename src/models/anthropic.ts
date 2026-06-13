import type {
  ModelParams,
  ModelCapabilities,
  StreamChunk,
  CompletionResult
} from '../core/types.js';
import { BaseModelAdapter, ensureApiVersionSuffix, joinApiUrl, toolsToModelSchema } from './base.js';
import { DEFAULT_ADAPTER_CAPABILITIES } from './default-capabilities.js';
import {
  logModelRequestEnd,
  logModelRequestFailure,
  logModelRequestStart,
  logModelStreamParseError
} from './model-request-log.js';

/**
 * Messages API 顶层 `metadata`：静态字典，或根据每次请求的 {@link ModelParams} 生成字典。
 */
export type AnthropicRequestMetadata =
  | Record<string, unknown>
  | ((params: ModelParams) => Record<string, unknown>);

/**
 * 初次 Messages API `POST` 的重试选项（不含 SSE 已建立后 `read` 中途断线）。
 * 未传 `fetchRetry` 时默认共 **2** 次尝试（即 **1** 次自动重试），退避基数 200ms、单次等待上限 2000ms。
 */
export interface AnthropicFetchRetryOptions {
  /**
   * 总尝试次数（含第一次）。省略 `fetchRetry` 时默认为 **2**（失败可再试 1 次）。
   * 设为 `1` 可关闭重试。
   * @example `4` → 首次失败后最多再试 3 次。
   */
  maxAttempts?: number;
  /** 指数退避的基准间隔（毫秒），默认 200。 */
  baseDelayMs?: number;
  /** 单次等待上限（毫秒），默认 2000；亦为 `Retry-After` 解析结果的上限。 */
  maxDelayMs?: number;
}

/** 未配置 `fetchRetry` 时的默认策略：最多 2 次 HTTP 尝试（网络抖动或 429/502/503/504 时可自动重试 1 次）。 */
const DEFAULT_FETCH_RETRY: Required<AnthropicFetchRetryOptions> = {
  maxAttempts: 2,
  baseDelayMs: 200,
  maxDelayMs: 2_000
};

function normalizeFetchRetry(options?: AnthropicFetchRetryOptions): Required<AnthropicFetchRetryOptions> {
  if (options == null) {
    return { ...DEFAULT_FETCH_RETRY };
  }
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_FETCH_RETRY.maxAttempts));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_FETCH_RETRY.baseDelayMs);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? DEFAULT_FETCH_RETRY.maxDelayMs);
  return { maxAttempts, baseDelayMs, maxDelayMs };
}

/** Soft guidance for adaptive thinking (Messages API `output_config.effort`). */
export type AnthropicThinkingEffort = 'low' | 'medium' | 'high' | 'max';

/**
 * Anthropic Messages API `thinking` 参数（扩展思考 / adaptive）。
 * 见 <https://docs.anthropic.com/en/build-with-claude/extended-thinking>。
 */
export type AnthropicThinkingConfigObject =
  | { type: 'enabled'; budget_tokens: number; display?: 'omitted' | string }
  | { type: 'disabled' }
  | { type: 'adaptive'; effort?: AnthropicThinkingEffort };

/**
 * 简单布尔或官方对象。`true` 等价于 `{ type: 'enabled', budget_tokens: 1024 }`；`false` 为 `{ type: 'disabled' }`。
 * `adaptive` 且带 `effort` 时，会额外写入 `output_config.effort`。
 */
export type AnthropicThinkingOption = boolean | AnthropicThinkingConfigObject;

const DEFAULT_THINKING_BUDGET_TOKENS = 1024;

/**
 * 将 `AnthropicThinkingOption` 转为请求体 `thinking` 与可选的 `output_config`。
 * @internal Exported for unit tests.
 */
export function applyAnthropicThinking(option: AnthropicThinkingOption): {
  thinking: Record<string, unknown>;
  outputConfig?: { effort: AnthropicThinkingEffort };
} {
  if (option === true) {
    return {
      thinking: { type: 'enabled', budget_tokens: DEFAULT_THINKING_BUDGET_TOKENS }
    };
  }
  if (option === false) {
    return { thinking: { type: 'disabled' } };
  }
  switch (option.type) {
    case 'adaptive': {
      const out: { thinking: Record<string, unknown>; outputConfig?: { effort: AnthropicThinkingEffort } } = {
        thinking: { type: 'adaptive' }
      };
      if (option.effort) {
        out.outputConfig = { effort: option.effort };
      }
      return out;
    }
    case 'enabled':
      return { thinking: { ...option } as Record<string, unknown> };
    case 'disabled':
      return { thinking: { type: 'disabled' } };
  }
}

/** Anthropic Messages API streaming `usage` slice (message_start / message_delta). */
export type AnthropicUsageSlice = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

/**
 * Full context size: billable input plus cache reads (Anthropic semantics).
 * @internal Exported for unit tests.
 */
export function computeActualInputTokens(u: AnthropicUsageSlice): number {
  return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
}

function pickUsageField(
  deltaVal: number | undefined,
  startVal: number | undefined,
  treatZeroAsAbsent: boolean
): number | undefined {
  if (deltaVal != null && (!treatZeroAsAbsent || deltaVal !== 0)) {
    return deltaVal;
  }
  return startVal;
}

/**
 * Merge `message_start` and `message_delta` usage per field: delta when present,
 * otherwise start. `input_tokens` treats 0 as absent; cache fields treat 0 as valid.
 * @internal Exported for unit tests.
 */
export function mergeAnthropicInputUsage(
  start: AnthropicUsageSlice | undefined,
  delta: AnthropicUsageSlice
): AnthropicUsageSlice {
  return {
    input_tokens: pickUsageField(delta.input_tokens, start?.input_tokens, true),
    cache_read_input_tokens: pickUsageField(
      delta.cache_read_input_tokens,
      start?.cache_read_input_tokens,
      false
    ),
    cache_creation_input_tokens: pickUsageField(
      delta.cache_creation_input_tokens,
      start?.cache_creation_input_tokens,
      false
    )
  };
}

/**
 * Resolve merged input/cache from start + delta; output tokens from delta only.
 * @internal Exported for unit tests.
 */
export function resolveAnthropicStreamUsage(
  start: AnthropicUsageSlice | undefined,
  delta: AnthropicUsageSlice
): {
  inputSource: AnthropicUsageSlice;
  outputTokens: number;
} {
  return {
    inputSource: mergeAnthropicInputUsage(start, delta),
    outputTokens: delta.output_tokens ?? 0
  };
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') {
    return true;
  }
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError';
}

function isRetriableFetchError(e: unknown): boolean {
  if (isAbortError(e)) {
    return false;
  }
  if (e instanceof TypeError) {
    return true;
  }
  const cause = typeof e === 'object' && e !== null && 'cause' in e
    ? (e as { cause?: { code?: string } }).cause
    : undefined;
  const code = cause?.code;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    code === 'UND_ERR_SOCKET'
  );
}

function isRetriableHttpStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** Parse Retry-After: delta-seconds or HTTP-date → wait ms (undefined if unparseable). */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (header == null || header === '') {
    return undefined;
  }
  const trimmed = header.trim();
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum >= 0) {
    return asNum * 1000;
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    const delta = parsed - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

function computeBackoffMs(
  attemptIndex: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attemptIndex);
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.min(maxDelayMs, Math.floor(exp * jitter));
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const id = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function drainResponseBody(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // ignore
  }
}

/**
 * Anthropic 配置
 */
export interface AnthropicConfig {
  apiKey?: string;
  /**
   * API version root (should include `/v1`, e.g. `https://api.anthropic.com/v1`).
   * If no trailing `/vN` segment is present, default `v1` is appended automatically.
   */
  baseUrl?: string;
  model?: string;
  version?: string;
  /** 自定义模型能力 (覆盖默认值) */
  capabilities?: ModelCapabilities;
  /**
   * 与 {@link ModelParams.sessionId} 合并进 Messages API 顶层 `metadata`（`sessionId` → `user_id`）。
   * 配置中的键可覆盖 `user_id`。
   */
  metadata?: AnthropicRequestMetadata;
  /**
   * 仅针对**建立连接前**的初次 `POST` 的重试策略，见 {@link AnthropicFetchRetryOptions}。
   * 省略时默认共 2 次尝试（**1** 次自动重试）；传入 `fetchRetry: { maxAttempts: 1 }` 可改为只请求 1 次、不重试。
   */
  fetchRetry?: AnthropicFetchRetryOptions;
  /**
   * Extended thinking / adaptive。省略则请求中不包含 `thinking`（保持与旧版一致）。
   */
  thinking?: AnthropicThinkingOption;
  /**
   * 构建默认请求体后浅合并到 JSON 顶层，`extraBody` 可覆盖适配器生成的字段。
   */
  extraBody?: Record<string, unknown>;
}

/**
 * Anthropic 模型适配器
 */
export class AnthropicAdapter extends BaseModelAdapter {
  get name(): string {
    return `anthropic/${this.model}`;
  }
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private version: string;
  private requestMetadata?: AnthropicRequestMetadata;
  private fetchRetry: Required<AnthropicFetchRetryOptions>;
  private thinkingOption?: AnthropicThinkingOption;
  private extraBody?: Record<string, unknown>;

  constructor(config: AnthropicConfig = {}) {
    super();
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = ensureApiVersionSuffix(
      config.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
    );
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.version = config.version || '2023-06-01';
    this.requestMetadata = config.metadata;
    this.fetchRetry = normalizeFetchRetry(config.fetchRetry);
    this.thinkingOption = config.thinking;
    this.extraBody = config.extraBody;

    if (!this.apiKey) {
      throw new Error('Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable or pass apiKey in config.');
    }

    this.capabilities = config.capabilities ?? DEFAULT_ADAPTER_CAPABILITIES;
  }

  clone(): AnthropicAdapter {
    return new AnthropicAdapter({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      model: this.model,
      version: this.version,
      metadata: this.requestMetadata,
      fetchRetry: this.fetchRetry,
      thinking: this.thinkingOption,
      extraBody: this.extraBody,
      capabilities: this.capabilities
    });
  }

  setModel(modelId: string): void {
    const t = modelId.trim();
    if (!t) {
      throw new Error('AnthropicAdapter.setModel: model id must be non-empty');
    }
    this.model = t;
  }

  async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(params, true);
    const response = await this.fetch('/messages', body, 'stream', params);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall: { id: string; name: string; input: string } | null = null;
    let currentThinkingBlock: { signature?: string } | null = null;
    let pendingStartUsage: AnthropicUsageSlice | undefined;

    try {
      while (true) {
        if (params.signal?.aborted) {
          reader.cancel();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          // 跳过 'data:' 前缀，可能有空格
          let jsonStart = 5;
          if (trimmed.length > 5 && trimmed[5] === ' ') {
            jsonStart = 6;
          }
          const jsonStr = trimmed.slice(jsonStart);

          try {
            const data = JSON.parse(jsonStr);
            const raw = params.includeRawStreamEvents ? { providerRaw: data as unknown } : {};

            switch (data.type) {
              case 'content_block_start':
                if (data.content_block?.type === 'tool_use') {
                  currentToolCall = {
                    id: data.content_block.id,
                    name: data.content_block.name,
                    input: ''
                  };
                  yield {
                    type: 'tool_call_start',
                    toolCall: {
                      id: data.content_block.id,
                      name: data.content_block.name,
                      arguments: {}
                    },
                    ...raw
                  };
                } else if (data.content_block?.type === 'thinking') {
                  const startSig = data.content_block.signature;
                  currentThinkingBlock = {};
                  if (typeof startSig === 'string' && startSig.length > 0) {
                    currentThinkingBlock.signature = startSig;
                  }
                  const thinkingChunk: StreamChunk = { type: 'thinking', ...raw };
                  if (data.content_block.thinking) {
                    thinkingChunk.content = data.content_block.thinking;
                  }
                  if (currentThinkingBlock.signature) {
                    thinkingChunk.signature = currentThinkingBlock.signature;
                  }
                  yield thinkingChunk;
                }
                break;

              case 'content_block_delta':
                if (data.delta?.type === 'text_delta') {
                  yield { type: 'text', content: data.delta.text, ...raw };
                } else if (data.delta?.type === 'thinking_delta') {
                  yield {
                    type: 'thinking',
                    content: data.delta.thinking,
                    signature: currentThinkingBlock?.signature,
                    ...raw
                  };
                } else if (data.delta?.type === 'signature_delta') {
                  const sig = data.delta.signature;
                  if (typeof sig === 'string' && sig.length > 0) {
                    if (currentThinkingBlock) {
                      currentThinkingBlock.signature = sig;
                    } else {
                      currentThinkingBlock = { signature: sig };
                    }
                    yield { type: 'thinking', signature: sig, ...raw };
                  }
                } else if (data.delta?.type === 'input_json_delta' && currentToolCall) {
                  currentToolCall.input += data.delta.partial_json;
                  yield {
                    type: 'tool_call_delta',
                    content: data.delta.partial_json,
                    toolCallId: currentToolCall.id,
                    ...raw
                  };
                }
                break;

              case 'content_block_stop':
                if (currentToolCall) {
                  yield {
                    type: 'tool_call',
                    toolCall: {
                      id: currentToolCall.id,
                      name: currentToolCall.name,
                      arguments: this.safeParseJSON(currentToolCall.input)
                    },
                    ...raw
                  };
                  currentToolCall = null;
                }
                if (currentThinkingBlock) {
                  yield { type: 'thinking_block_end', ...raw };
                  currentThinkingBlock = null;
                }
                break;

              case 'message_start':
                if (data.message?.usage) {
                  pendingStartUsage = data.message.usage as AnthropicUsageSlice;
                }
                break;

              case 'message_delta':
                if (data.usage) {
                  const { inputSource, outputTokens } = resolveAnthropicStreamUsage(
                    pendingStartUsage,
                    data.usage as AnthropicUsageSlice
                  );
                  const actualInputTokens = computeActualInputTokens(inputSource);
                  if (actualInputTokens > 0) {
                    yield {
                      type: 'metadata',
                      usagePhase: 'input',
                      metadata: {
                        usage: {
                          promptTokens: actualInputTokens,
                          completionTokens: 0,
                          totalTokens: actualInputTokens,
                          cacheReadTokens: inputSource.cache_read_input_tokens ?? 0,
                          cacheWriteTokens: inputSource.cache_creation_input_tokens ?? 0
                        }
                      },
                      ...raw
                    };
                  }
                  if (outputTokens > 0) {
                    yield {
                      type: 'metadata',
                      usagePhase: 'output',
                      metadata: {
                        usage: {
                          promptTokens: 0,
                          completionTokens: outputTokens,
                          totalTokens: outputTokens
                        }
                      },
                      ...raw
                    };
                  }
                }
                break;
            }
          } catch (error) {
            logModelStreamParseError(
              {
                provider: 'anthropic',
                model: this.model,
                path: '/messages',
                operation: 'stream',
                params
              },
              jsonStr,
              error
            );
          }
        }
      }

      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }

  async complete(params: ModelParams): Promise<CompletionResult> {
    const body = this.buildRequestBody(params, false);
    const response = await this.fetch('/messages', body, 'complete', params);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }>;
      usage?: unknown;
    };
    const result: CompletionResult = {
      content: ''
    };

    // 处理内容块
    const toolCalls: Array<{ id: string; name: string; arguments: unknown }> = [];
    const thinkingParts: string[] = [];
    for (const block of data.content || []) {
      if (block.type === 'text' && typeof block.text === 'string') {
        result.content += block.text;
      } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.length > 0) {
        thinkingParts.push(block.thinking);
      } else if (block.type === 'tool_use' && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input
        });
      }
    }
    if (thinkingParts.length > 0) {
      result.thinking = thinkingParts.join('\n\n');
    }

    if (toolCalls.length > 0) {
      result.toolCalls = toolCalls;
    }

    // 处理使用统计
    if (data.usage && typeof data.usage === 'object') {
      const usage = data.usage as {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
      // Anthropic 的 input_tokens 已扣除缓存命中的部分
      // 完整的上下文大小 = input_tokens + cache_read_input_tokens
      const actualInputTokens = usage.input_tokens + (usage.cache_read_input_tokens || 0);
      result.usage = {
        promptTokens: actualInputTokens,
        completionTokens: usage.output_tokens,
        totalTokens: actualInputTokens + usage.output_tokens
      };
    }

    return result;
  }

  private buildRequestBody(params: ModelParams, stream: boolean): unknown {
    const { system, messages } = this.extractSystemMessage(params.messages);
    const transformedMessages = this.transformAnthropicMessages(messages);

    const defaultMaxTokens =
      this.capabilities?.maxOutputTokens ?? DEFAULT_ADAPTER_CAPABILITIES.maxOutputTokens;
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: params.maxTokens ?? defaultMaxTokens,
      messages: transformedMessages,
      stream,
      ...(system && { system }),
      ...(params.temperature !== undefined && { temperature: params.temperature })
    };

    // 添加工具
    if (params.tools && params.tools.length > 0) {
      body.tools = toolsToModelSchema(params.tools).map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters
      }));
    }

    const mergedMetadata = this.mergeAnthropicMetadata(params);
    if (mergedMetadata && Object.keys(mergedMetadata).length > 0) {
      body.metadata = mergedMetadata;
    }

    if (this.thinkingOption !== undefined) {
      const { thinking, outputConfig } = applyAnthropicThinking(this.thinkingOption);
      body.thinking = thinking;
      if (outputConfig) {
        body.output_config = outputConfig;
      }
    }

    if (this.extraBody) {
      Object.assign(body, this.extraBody);
    }

    return body;
  }

  /**
   * Build Messages API `metadata`: `sessionId` → `user_id`, merged with resolved adapter `metadata` (dict or fn).
   * Config `metadata` keys override `user_id` when duplicated.
   */
  private mergeAnthropicMetadata(params: ModelParams): Record<string, unknown> | undefined {
    const extra = this.resolveMetadataExtra(params);
    const hasSession = params.sessionId !== undefined && params.sessionId !== '';
    if (!hasSession && extra === undefined) {
      return undefined;
    }
    const merged: Record<string, unknown> = {};
    if (hasSession) {
      merged.user_id = params.sessionId;
    }
    if (extra !== undefined) {
      Object.assign(merged, extra);
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  private resolveMetadataExtra(params: ModelParams): Record<string, unknown> | undefined {
    const raw = this.requestMetadata;
    if (raw == null) {
      return undefined;
    }
    if (typeof raw === 'function') {
      const v = raw(params);
      if (
        typeof v !== 'object' ||
        v === null ||
        Array.isArray(v) ||
        Object.keys(v).length === 0
      ) {
        return undefined;
      }
      return { ...v };
    }
    if (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length > 0) {
      return { ...raw };
    }
    return undefined;
  }

  private extractSystemMessage(messages: ModelParams['messages']): {
    system?: string;
    messages: ModelParams['messages'];
  } {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    // 合并多条 system 消息为一条
    const combinedSystem = systemMessages.length > 0
      ? systemMessages.map(m => m.content as string).join('\n\n')
      : undefined;

    return {
      system: combinedSystem,
      messages: otherMessages
    };
  }

  private transformAnthropicMessages(messages: ModelParams['messages']): unknown[] {
    return messages.map(msg => {
      const transformed: Record<string, unknown> = {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: []
      };

      if (typeof msg.content === 'string') {
        transformed.content = [{ type: 'text', text: msg.content }];
      } else if (Array.isArray(msg.content)) {
        // 处理 ContentPart 数组
        const contentParts: any[] = [];
        for (const part of msg.content) {
          if (part.type === 'thinking') {
            if (part.thinking && part.signature) {
              contentParts.push(part);
            }
            continue;
          } else if (part.type === 'text') {
            contentParts.push({ type: 'text', text: (part as any).text });
          } else {
            contentParts.push(part);
          }
        }
        transformed.content = contentParts;

        // 如果过滤后为空，设置空字符串
        if (contentParts.length === 0) {
          transformed.content = '';
        }
      }

      // 处理工具调用
      if (msg.toolCalls && msg.role === 'assistant') {
        for (const tc of msg.toolCalls) {
          (transformed.content as any[]).push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments
          });
        }
      }

      // 处理工具结果
      if (msg.role === 'tool' && msg.toolCallId) {
        transformed.role = 'user';
        transformed.content = [{
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: msg.content
        }];
      }

      return transformed;
    });
  }

  /**
   * 发起 POST；按 `fetchRetry` 对网络错误与 429/502/503/504 重试（不含响应体已开始消费后的 SSE 读失败）。
   */
  private async fetch(
    path: string,
    body: unknown,
    operation: 'stream' | 'complete',
    params: ModelParams
  ): Promise<Response> {
    const requestLog = logModelRequestStart(
      {
        provider: 'anthropic',
        model: this.model,
        path,
        operation,
        params
      },
      body,
      { httpMaxAttempts: this.fetchRetry.maxAttempts }
    );
    const url = joinApiUrl(this.baseUrl, path);
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.version
      },
      body: JSON.stringify(body),
      signal: params.signal
    };

    for (let attempt = 0; attempt < this.fetchRetry.maxAttempts; attempt++) {
      const httpAttemptMeta = {
        httpAttempt: attempt + 1,
        httpMaxAttempts: this.fetchRetry.maxAttempts
      };

      if (params.signal?.aborted) {
        logModelRequestFailure(
          {
            provider: 'anthropic',
            model: this.model,
            path,
            operation,
            params
          },
          requestLog,
          new DOMException('The operation was aborted.', 'AbortError'),
          { httpMaxAttempts: this.fetchRetry.maxAttempts }
        );
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      try {
        const response = await globalThis.fetch(url, init);
        if (response.ok) {
          logModelRequestEnd(
            {
              provider: 'anthropic',
              model: this.model,
              path,
              operation,
              params
            },
            requestLog,
            response,
            httpAttemptMeta
          );
          return response;
        }

        const canRetryHttp =
          attempt < this.fetchRetry.maxAttempts - 1 && isRetriableHttpStatus(response.status);
        if (canRetryHttp) {
          await drainResponseBody(response);
          const fromHeader = parseRetryAfterMs(response.headers.get('Retry-After'));
          const backoff = computeBackoffMs(attempt, this.fetchRetry.baseDelayMs, this.fetchRetry.maxDelayMs);
          const waitMs =
            fromHeader != null
              ? Math.min(fromHeader, this.fetchRetry.maxDelayMs)
              : backoff;
          await delay(waitMs, params.signal);
          continue;
        }

        logModelRequestEnd(
          {
            provider: 'anthropic',
            model: this.model,
            path,
            operation,
            params
          },
          requestLog,
          response,
          httpAttemptMeta
        );
        return response;
      } catch (e) {
        if (isAbortError(e) || params.signal?.aborted) {
          logModelRequestFailure(
            {
              provider: 'anthropic',
              model: this.model,
              path,
              operation,
              params
            },
            requestLog,
            e,
            httpAttemptMeta
          );
          throw e;
        }
        if (attempt < this.fetchRetry.maxAttempts - 1 && isRetriableFetchError(e)) {
          const backoff = computeBackoffMs(attempt, this.fetchRetry.baseDelayMs, this.fetchRetry.maxDelayMs);
          await delay(backoff, params.signal);
          continue;
        }
        logModelRequestFailure(
          {
            provider: 'anthropic',
            model: this.model,
            path,
            operation,
            params
          },
          requestLog,
          e,
          httpAttemptMeta
        );
        throw e;
      }
    }

    throw new Error('Anthropic fetch: unexpected retry loop exit');
  }

  private safeParseJSON(str: string): unknown {
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }
}

/**
 * 创建 Anthropic 适配器
 */
export function createAnthropic(config?: AnthropicConfig): AnthropicAdapter {
  return new AnthropicAdapter(config);
}
