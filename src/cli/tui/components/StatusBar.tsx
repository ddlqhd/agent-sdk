import React from 'react';
import { Box, Text } from 'ink';
import type { SessionStatusSnapshot } from '../../utils/session-status.js';
import { formatCompactTokens } from '../format-tokens.js';

interface StatusBarProps {
  snapshot: SessionStatusSnapshot | null;
  streaming?: boolean;
}

export function StatusBar({ snapshot, streaming = false }: StatusBarProps): React.ReactElement {
  if (!snapshot) {
    return (
      <Box paddingX={1}>
        <Text dimColor>status: loading…</Text>
      </Box>
    );
  }

  const sid = snapshot.sessionId ? snapshot.sessionId.slice(0, 8) + '…' : 'new';
  const parts = [
    `sess:${sid}`,
    `msgs:${snapshot.activeMessageCount}`,
    `chk:${snapshot.checkpointCount}`,
    `in:${formatCompactTokens(snapshot.usage.inputTokens)}`,
    `out:${formatCompactTokens(snapshot.usage.outputTokens)}`
  ];
  if (snapshot.verbose) parts.push('verbose');
  if (streaming) parts.push('streaming…');

  return (
    <Box paddingX={1}>
      <Text dimColor>{parts.join(' | ')}</Text>
    </Box>
  );
}
