import React from 'react';
import { Box, Text } from 'ink';
import { SLASH_COMMANDS } from '../../../utils/slash-registry.js';

export function HelpPanel(): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1} marginY={1}>
      <Text bold>Slash commands (Esc close — you can keep typing)</Text>
      {SLASH_COMMANDS.map((c) => (
        <Text key={c.name}>
          /{c.name} — {c.description}
        </Text>
      ))}
    </Box>
  );
}
