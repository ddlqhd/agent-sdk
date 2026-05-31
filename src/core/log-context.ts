import { emitSDKLog } from './logger.js';
import type { LogEvent, SDKLogContext, SDKLogLevel, SDKLogSink } from './types.js';

export type { SDKLogContext } from './types.js';

/** Log payload without `source` (added by {@link sdkLog}). Scope fields may override context. */
export type SDKLogEventInput = Omit<LogEvent, 'source'>;

/**
 * Build a log context from {@link SDKLogSink} and optional scope fields.
 */
export function createSDKLogContext(
  sink: SDKLogSink,
  scope?: Partial<Pick<SDKLogContext, 'sessionId' | 'runId' | 'agentName' | 'cwd'>>
): SDKLogContext {
  return {
    logger: sink.logger,
    logLevel: sink.logLevel,
    redaction: sink.redaction,
    ...scope
  };
}

/**
 * Shallow-merge scope onto an existing context (e.g. set `runId` at run start).
 */
export function withLogScope(
  ctx: SDKLogContext,
  scope: Partial<SDKLogContext>
): SDKLogContext {
  return {
    ...ctx,
    ...scope,
    logger: scope.logger ?? ctx.logger,
    logLevel: scope.logLevel ?? ctx.logLevel,
    redaction: scope.redaction ?? ctx.redaction
  };
}

/** Prefer context scope unless the event sets a non-empty string. */
function coalesceScopeField(
  fromEvent: string | undefined,
  fromCtx: string | undefined
): string | undefined {
  if (fromEvent !== undefined && fromEvent !== '') {
    return fromEvent;
  }
  return fromCtx;
}

function mergeScopeIntoEvent(
  ctx: SDKLogContext,
  event: SDKLogEventInput
): Omit<LogEvent, 'source'> {
  const { sessionId, runId, agentName, cwd, ...rest } = event;
  return {
    ...rest,
    sessionId: coalesceScopeField(sessionId, ctx.sessionId),
    runId: coalesceScopeField(runId, ctx.runId),
    agentName: coalesceScopeField(agentName, ctx.agentName),
    cwd: coalesceScopeField(cwd, ctx.cwd)
  };
}

/**
 * Emit a structured SDK log using {@link SDKLogContext} for sink and correlation fields.
 * Non-empty fields on `event` override context scope; use `undefined` to inherit from `ctx`.
 */
export function sdkLog(
  ctx: SDKLogContext | undefined,
  level: Exclude<SDKLogLevel, 'silent'>,
  event: SDKLogEventInput
): void {
  if (ctx == null) {
    return;
  }
  emitSDKLog({
    logger: ctx.logger,
    logLevel: ctx.logLevel,
    redaction: ctx.redaction,
    level,
    event: mergeScopeIntoEvent(ctx, event)
  });
}
