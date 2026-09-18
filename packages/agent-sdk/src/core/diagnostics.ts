import diagnosticsChannel from 'node:diagnostics_channel';

export const SDK_DIAGNOSTIC_CHANNELS = {
  run: 'agent-sdk:run',
  modelRequest: 'agent-sdk:model.request'
} as const;

const runChannel = diagnosticsChannel.channel(SDK_DIAGNOSTIC_CHANNELS.run);
const modelRequestChannel = diagnosticsChannel.channel(SDK_DIAGNOSTIC_CHANNELS.modelRequest);

export interface SdkDiagnosticPayload {
  event: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

/**
 * Publish a diagnostic payload when subscribers are listening (zero cost otherwise).
 *
 * Does **not** mirror {@link sdkLog} / {@link LogEvent} automatically — subscribe to the
 * channels and call this from host code, or wire your own bridge from `SDKLogger`.
 */
export function publishSdkDiagnostic(
  channelName: keyof typeof SDK_DIAGNOSTIC_CHANNELS,
  event: string,
  data?: Record<string, unknown>
): void {
  const channel =
    channelName === 'run' ? runChannel : modelRequestChannel;
  if (!channel.hasSubscribers) {
    return;
  }
  const payload: SdkDiagnosticPayload = {
    event,
    timestamp: Date.now(),
    ...(data !== undefined ? { data } : {})
  };
  channel.publish(payload);
}
