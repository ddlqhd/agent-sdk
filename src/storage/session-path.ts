import { homedir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from './session.js';

/**
 * Same directory as {@link Agent} session storage: `<userBase>/.claude/sessions`.
 */
export function getSessionStoragePath(userBasePath?: string): string {
  return join(userBasePath || homedir(), '.claude', 'sessions');
}

/**
 * Most recently updated session id from JSONL storage, or `undefined` if none.
 */
export async function getLatestSessionId(userBasePath?: string): Promise<string | undefined> {
  const sm = new SessionManager({
    type: 'jsonl',
    basePath: getSessionStoragePath(userBasePath)
  });
  const list = await sm.listSessions();
  return list[0]?.id;
}
