import React from 'react';
import { Box, Text } from 'ink';

interface InputAreaProps {
  input: string;
  streaming: boolean;
}

export function InputArea({ input, streaming }: InputAreaProps): React.ReactElement {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text color="green">{streaming ? '…' : '› '}</Text>
      <Text>{input}</Text>
      <Text dimColor>{streaming ? '' : '█'}</Text>
    </Box>
  );
}
