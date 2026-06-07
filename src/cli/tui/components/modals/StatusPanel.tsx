import React from 'react';
import { Box, Text } from 'ink';
import type { SessionStatusSnapshot } from '../../../utils/session-status.js';

interface StatusPanelProps {
  snapshot: SessionStatusSnapshot | null;
}

export function StatusPanel({ snapshot }: StatusPanelProps): React.ReactElement {
  if (!snapshot) {
    return (
      <Box flexDirection="column" borderStyle="double" paddingX={1} marginY={1}>
        <Text bold>Session status (Esc close — you can keep typing)</Text>
        <Text dimColor>Loading…</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1} marginY={1}>
      <Text bold>Session status (Esc close — you can keep typing)</Text>
      <Text>session: {snapshot.sessionId ?? '(none — next message creates one)'}</Text>
      <Text>model: {snapshot.modelName}</Text>
      <Text>messages: {snapshot.activeMessageCount} active</Text>
      <Text>checkpoints: {snapshot.checkpointCount}</Text>
      <Text>
        tokens: in={snapshot.usage.inputTokens} out={snapshot.usage.outputTokens} total=
        {snapshot.usage.totalTokens}
      </Text>
      {snapshot.context ? (
        <Text>
          context: used={snapshot.context.used} usable={snapshot.context.usable} compressions=
          {snapshot.context.compressCount}
        </Text>
      ) : (
        <Text dimColor>context: disabled</Text>
      )}
      <Text>verbose: {snapshot.verbose ? 'on' : 'off'}</Text>
      <Text>cwd: {snapshot.cwd}</Text>
      {snapshot.lastUserPreview ? <Text dimColor>last user: {snapshot.lastUserPreview}</Text> : null}
      {snapshot.lastAssistantPreview ? (
        <Text dimColor>last reply: {snapshot.lastAssistantPreview}</Text>
      ) : null}
    </Box>
  );
}
