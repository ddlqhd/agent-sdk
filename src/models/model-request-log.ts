import { randomUUID } from 'crypto';
import type { ModelParams } from '../core/types.js';
import {
  emitSDKLog,
  extractProviderRequestId,
  resolveLogRedaction,
  sanitizeForLogging
} from '../core/logger.js';

export interface ModelRequestLogContext {
  provider: string;
  model: string;
  path: string;
  operation: 'stream' | 'complete';
  params?: Pick<ModelParams, 'logger' | 'logLevel' | 'redaction' | 'sessionId'>;
  iteration?: number;
}

export interface ModelRequestLogState {
  clientRequestId: string;
  startedAt: number;
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

function buildRequestMetadata(body: unknown, params?: ModelRequestLogContext['params']): Record<string, unknown> {
  const redaction = resolveLogRedaction(params?.redaction);
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

  emitSDKLog({
    logger: context.params?.logger,
    logLevel: context.params?.logLevel,
    level: 'info',
    event: {
      component: 'model',
      event: 'model.request.start',
      message: `Starting ${context.operation} request`,
      provider: context.provider,
      model: context.model,
      operation: context.operation,
      sessionId: context.params?.sessionId,
      iteration: context.iteration,
      clientRequestId: state.clientRequestId,
      metadata: {
        path: context.path,
        ...buildRequestMetadata(body, context.params),
        ...extraMetadata
      }
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
  emitSDKLog({
    logger: context.params?.logger,
    logLevel: context.params?.logLevel,
    level: response.ok ? 'info' : 'warn',
    event: {
      component: 'model',
      event: response.ok ? 'model.request.end' : 'model.request.error',
      message: response.ok ? 'Model request completed' : 'Model request returned error response',
      provider: context.provider,
      model: context.model,
      operation: context.operation,
      sessionId: context.params?.sessionId,
      iteration: context.iteration,
      clientRequestId: state.clientRequestId,
      requestId: extractProviderRequestId(response.headers),
      statusCode: response.status,
      durationMs: Date.now() - state.startedAt,
      metadata: {
        path: context.path,
        ...extraMetadata
      }
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
  emitSDKLog({
    logger: context.params?.logger,
    logLevel: context.params?.logLevel,
    level: err.name === 'AbortError' ? 'info' : 'error',
    event: {
      component: 'model',
      event: err.name === 'AbortError' ? 'model.request.aborted' : 'model.request.error',
      message: err.name === 'AbortError' ? 'Model request aborted' : 'Model request failed',
      provider: context.provider,
      model: context.model,
      operation: context.operation,
      sessionId: context.params?.sessionId,
      iteration: context.iteration,
      clientRequestId: state.clientRequestId,
      durationMs: Date.now() - state.startedAt,
      errorName: err.name,
      errorMessage: err.message,
      metadata: {
        path: context.path,
        ...extraMetadata
      }
    }
  });
}

export function logModelStreamParseError(
  context: ModelRequestLogContext,
  rawChunk: string,
  error: unknown
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const redaction = resolveLogRedaction(context.params?.redaction);
  emitSDKLog({
    logger: context.params?.logger,
    logLevel: context.params?.logLevel,
    level: 'warn',
    event: {
      component: 'streaming',
      event: 'model.stream.parse_error',
      message: 'Failed to parse provider stream chunk',
      provider: context.provider,
      model: context.model,
      operation: context.operation,
      sessionId: context.params?.sessionId,
      iteration: context.iteration,
      errorName: err.name,
      errorMessage: err.message,
      metadata: {
        path: context.path,
        rawChunk: sanitizeForLogging(rawChunk, redaction)
      }
    }
  });
}
