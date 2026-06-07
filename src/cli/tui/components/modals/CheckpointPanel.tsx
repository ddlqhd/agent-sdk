import React from 'react';
import { Box, Text } from 'ink';
import type { SessionCheckpoint } from '../../../../core/types.js';

interface CheckpointPanelProps {
  checkpoints: SessionCheckpoint[];
  selectedIndex: number;
}

export function CheckpointPanel({ checkpoints, selectedIndex }: CheckpointPanelProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1} marginY={1}>
      <Text bold>Checkpoints (↑↓ Enter rewind, Esc close)</Text>
      {checkpoints.length === 0 ? (
        <Text dimColor>None</Text>
      ) : (
        checkpoints.map((c, i) => (
          <Text key={c.checkpointId} color={i === selectedIndex ? 'cyan' : undefined}>
            {i === selectedIndex ? '> ' : '  '}#{c.userTurnIndex} {c.preview.slice(0, 50)}
          </Text>
        ))
      )}
    </Box>
  );
}
