import { randomUUID } from 'crypto';
import { createSDKLogContext, sdkLog } from '../core/log-context.js';
import type { SDKLogContext } from '../core/types.js';
import type { ModelParams } from '../core/types.js';
import {
  extractProviderRequestId,
  resolveLogRedaction,
  sanitizeForLogging
} from '../core/logger.js';

export interface ModelRequestLogContext {
  provider: string;
  model: string;
  path: string;
  operation: 'stream' | 'complete';
  /** Preferred structured log context. */
  ctx?: SDKLogContext;
  /** @deprecated Use `ctx` or `params.logContext`. */
  params?: Pick<
    ModelParams,
    'logger' | 'logLevel' | 'redaction' | 'sessionId' | 'runId' | 'agentName' | 'logContext'
  >;
  iteration?: number;
}

export interface ModelRequestLogState {
  clientRequestId: string;
  startedAt: number;
}

function resolveLogCtx(context: ModelRequestLogContext): SDKLogContext | undefined {
  if (context.ctx != null) {
    return context.ctx;
  }
  const p = context.params;
  if (p == null) {
    return undefined;
  }
  if (p.logContext != null) {
    return p.logContext;
  }
  return createSDKLogContext(
    {
      logger: p.logger,
      logLevel: p.logLevel,
      redaction: p.redaction
    },
    {
      sessionId: p.sessionId,
      runId: p.runId,
      agentName: p.agentName
    }
  );
}

function resolveRedaction(context: ModelRequestLogContext) {
  const ctx = resolveLogCtx(context);
  return resolveLogRedaction(ctx?.redaction ?? context.params?.redaction);
}

function peelHttpRetry(meta?: Record<string, unknown>): {
  httpAttempt?: number;
  httpMaxAttempts?: number;
  remainder: Record<string, unknown>;
} {
  if (meta == null) {
    return { remainder: {} };
  }
  const clone = { ...meta };
  const httpAttemptRaw = clone.httpAttempt;
  const httpMaxAttemptsRaw = clone.httpMaxAttempts;
  delete clone.httpAttempt;
  delete clone.httpMaxAttempts;
  const httpAttempt =
    typeof httpAttemptRaw === 'number' && Number.isFinite(httpAttemptRaw)
      ? httpAttemptRaw
      : undefined;
  const httpMaxAttempts =
    typeof httpMaxAttemptsRaw === 'number' && Number.isFinite(httpMaxAttemptsRaw)
      ? httpMaxAttemptsRaw
      : undefined;
  return {
    httpAttempt,
    httpMaxAttempts,
    remainder: clone
  };
}

function countMessages(body: unknown): number | undefined {
  if (body == null || typeof body !== 'object' || !('messages' in body)) {
    return undefined;
  }
  const messages = (body as { messages?: unknown }).messages;
  return Array.isArray(messages) ? messages.length : undefined;
}

function countTools(body: unknown): number | undefined {
  if (body == null || typeof body !== 'object' || !('tools' in body)) {
    return undefined;
  }
  const tools = (body as { tools?: unknown }).tools;
  return Array.isArray(tools) ? tools.length : undefined;
}

function buildRequestMetadata(body: unknown, context: ModelRequestLogContext): Record<string, unknown> {
  const redaction = resolveRedaction(context);
  const metadata: Record<string, unknown> = {};
  const messageCount = countMessages(body);
  const toolCount = countTools(body);

  if (messageCount !== undefined) metadata.messageCount = messageCount;
  if (toolCount !== undefined) metadata.toolCount = toolCount;
  if (redaction.includeBodies) {
    metadata.requestBody = sanitizeForLogging(body, redaction);
  }

  return metadata;
}

export function logModelRequestStart(
  context: ModelRequestLogContext,
  body: unknown,
  extraMetadata?: Record<string, unknown>
): ModelRequestLogState {
  const state: ModelRequestLogState = {
    clientRequestId: randomUUID(),
    startedAt: Date.now()
  };

  const peeled = peelHttpRetry(extraMetadata);
  sdkLog(resolveLogCtx(context), 'info', {
    component: 'model',
    event: 'model.request.start',
    message: `Starting ${context.operation} request`,
    provider: context.provider,
    model: context.model,
    operation: context.operation,
    iteration: context.iteration,
    clientRequestId: state.clientRequestId,
    ...(peeled.httpAttempt !== undefined ? { httpAttempt: peeled.httpAttempt } : {}),
    ...(peeled.httpMaxAttempts !== undefined ? { httpMaxAttempts: peeled.httpMaxAttempts } : {}),
    metadata: {
      path: context.path,
      ...buildRequestMetadata(body, context),
      ...peeled.remainder
    }
  });

  return state;
}

export function logModelRequestEnd(
  context: ModelRequestLogContext,
  state: ModelRequestLogState,
  response: Response,
  extraMetadata?: Record<string, unknown>
): void {
  const peeled = peelHttpRetry(extraMetadata);
  sdkLog(resolveLogCtx(context), response.ok ? 'info' : 'warn', {
    component: 'model',
    event: response.ok ? 'model.request.end' : 'model.request.error',
    message: response.ok ? 'Model request completed' : 'Model request returned error response',
    provider: context.provider,
    model: context.model,
    operation: context.operation,
    iteration: context.iteration,
    clientRequestId: state.clientRequestId,
    requestId: extractProviderRequestId(response.headers),
    statusCode: response.status,
    durationMs: Date.now() - state.startedAt,
    ...(peeled.httpAttempt !== undefined ? { httpAttempt: peeled.httpAttempt } : {}),
    ...(peeled.httpMaxAttempts !== undefined ? { httpMaxAttempts: peeled.httpMaxAttempts } : {}),
    metadata: {
      path: context.path,
      ...peeled.remainder
    }
  });
}

export function logModelRequestFailure(
  context: ModelRequestLogContext,
  state: ModelRequestLogState,
  error: unknown,
  extraMetadata?: Record<string, unknown>
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const peeled = peelHttpRetry(extraMetadata);
  sdkLog(resolveLogCtx(context), err.name === 'AbortError' ? 'info' : 'error', {
    component: 'model',
    event: err.name === 'AbortError' ? 'model.request.aborted' : 'model.request.error',
    message: err.name === 'AbortError' ? 'Model request aborted' : 'Model request failed',
    provider: context.provider,
    model: context.model,
    operation: context.operation,
    iteration: context.iteration,
    clientRequestId: state.clientRequestId,
    durationMs: Date.now() - state.startedAt,
    errorName: err.name,
    errorMessage: err.message,
    ...(peeled.httpAttempt !== undefined ? { httpAttempt: peeled.httpAttempt } : {}),
    ...(peeled.httpMaxAttempts !== undefined ? { httpMaxAttempts: peeled.httpMaxAttempts } : {}),
    metadata: {
      path: context.path,
      ...peeled.remainder
    }
  });
}

export function logModelStreamParseError(
  context: ModelRequestLogContext,
  rawChunk: string,
  error: unknown
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const redaction = resolveRedaction(context);
  sdkLog(resolveLogCtx(context), 'warn', {
    component: 'streaming',
    event: 'model.stream.parse_error',
    message: 'Failed to parse provider stream chunk',
    provider: context.provider,
    model: context.model,
    operation: context.operation,
    iteration: context.iteration,
    errorName: err.name,
    errorMessage: err.message,
    metadata: {
      path: context.path,
      rawChunk: sanitizeForLogging(rawChunk, redaction)
    }
  });
}
