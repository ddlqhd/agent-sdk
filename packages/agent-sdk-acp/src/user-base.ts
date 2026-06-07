import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Stable user-level base path for session/skill/memory storage.
 * Without AGENT_SDK_ACP_USER_BASE, all sessions share tmpdir()/agent-sdk-acp.
 */
export function resolveAcpUserBase(): string {
  const fromEnv = process.env.AGENT_SDK_ACP_USER_BASE?.trim();
  if (fromEnv) return fromEnv;
  return join(tmpdir(), 'agent-sdk-acp');
}
