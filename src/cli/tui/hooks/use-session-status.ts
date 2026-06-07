import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent } from '../../../core/agent.js';
import {
  collectSessionStatus,
  type SessionStatusSnapshot
} from '../../utils/session-status.js';

export interface UseSessionStatusOptions {
  agent: Agent;
  sessionId?: string;
  verbose: boolean;
  streaming: boolean;
  cwd: string;
}

export function useSessionStatus(opts: UseSessionStatusOptions): {
  snapshot: SessionStatusSnapshot | null;
  refresh: () => Promise<void>;
} {
  const { agent, sessionId, verbose, streaming, cwd } = opts;
  const [snapshot, setSnapshot] = useState<SessionStatusSnapshot | null>(null);
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;

  const refresh = useCallback(async () => {
    const snap = await collectSessionStatus(agent, {
      sessionId,
      verbose,
      streaming: streamingRef.current,
      cwd
    });
    setSnapshot(snap);
  }, [agent, sessionId, verbose, cwd]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setSnapshot((prev) => (prev ? { ...prev, streaming } : prev));
  }, [streaming]);

  return { snapshot, refresh };
}
