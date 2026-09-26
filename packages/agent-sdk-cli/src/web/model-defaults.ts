import type { WebRuntimeDefaults } from './agent-factory.js';

/**
 * The four model fields a `configure` persist may rewrite.
 * Everything else in {@link WebRuntimeDefaults} is fixed at server start.
 */
export type MutableModelDefaults = Pick<
  WebRuntimeDefaults,
  'provider' | 'model' | 'baseUrl' | 'apiKey'
>;

/**
 * Copy the mutable model defaults for one WebSocket connection.
 *
 * `defaults` is shared by every connection and is refreshed after a persist so that
 * connections opened later see the saved file. Connections that already exist must
 * keep their own value: a persist from one client may switch `provider`, which would
 * otherwise invalidate the "keep the saved key" decision another client already made.
 *
 * @param defaults - Server-wide defaults
 * @returns A private snapshot owned by the calling connection
 */
export function snapshotModelDefaults(defaults: WebRuntimeDefaults): MutableModelDefaults {
  return {
    provider: defaults.provider,
    model: defaults.model,
    baseUrl: defaults.baseUrl,
    apiKey: defaults.apiKey
  };
}

/**
 * Merge a connection snapshot over the server-wide defaults.
 * @param defaults - Server-wide defaults (static fields plus the latest persisted values)
 * @param seed - Snapshot taken by {@link snapshotModelDefaults}
 * @returns Defaults as seen by this connection's `hello` handshake and `buildAgent`
 */
export function withModelDefaults(
  defaults: WebRuntimeDefaults,
  seed: MutableModelDefaults
): WebRuntimeDefaults {
  return { ...defaults, ...seed };
}

/**
 * Apply values read back from the settings file after a successful persist.
 * Updates the connection's own snapshot and the server-wide defaults;
 * snapshots held by other connections are left untouched.
 *
 * @param defaults - Server-wide defaults, mutated so later connections pick the values up
 * @param seed - Persisting connection's snapshot, mutated to match the file
 * @param next - Values as stored (or re-read) from the settings file
 */
export function applyPersistedModelDefaults(
  defaults: WebRuntimeDefaults,
  seed: MutableModelDefaults,
  next: MutableModelDefaults
): void {
  Object.assign(seed, next);
  Object.assign(defaults, next);
}
