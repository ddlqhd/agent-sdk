import React from 'react';
import { Box, Text } from 'ink';

interface TuiHeaderProps {
  modelName: string;
  cwd: string;
}

export function TuiHeader({ modelName, cwd }: TuiHeaderProps): React.ReactElement {
  const cwdShort = cwd.length > 40 ? '…' + cwd.slice(-38) : cwd;
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text>
        Agent SDK TUI | {modelName} | {cwdShort}
      </Text>
    </Box>
  );
}
