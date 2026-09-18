import React from 'react';
import { Box, Text } from 'ink';
import type { SessionPickerItem } from '../../../utils/session-cli.js';

interface SessionPickerProps {
  sessions: SessionPickerItem[];
  selectedIndex: number;
}

export function SessionPicker({ sessions, selectedIndex }: SessionPickerProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1} marginY={1}>
      <Text bold>Sessions (↑↓ Enter switch, Esc close)</Text>
      {sessions.length === 0 ? (
        <Text dimColor>No saved sessions.</Text>
      ) : (
        sessions.map((s, i) => (
          <Text key={s.id} color={i === selectedIndex ? 'cyan' : undefined}>
            {i === selectedIndex ? '> ' : '  '}
            {s.id.slice(0, 8)}… entries={s.messageCount}{' '}
            {s.preview ? s.preview.slice(0, 40) : ''}
          </Text>
        ))
      )}
    </Box>
  );
}
