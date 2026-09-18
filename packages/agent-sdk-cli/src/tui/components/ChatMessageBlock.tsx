import React from 'react';
import { Box, Text } from 'ink';
import type { ChatLine } from '../types.js';
import {
  borderColorForLine,
  displayTextForLine,
  isDimLine
} from '../message-block-styles.js';

interface ChatMessageBlockProps {
  line: ChatLine;
}

export function ChatMessageBlock({ line }: ChatMessageBlockProps): React.ReactElement {
  const borderColor = borderColorForLine(line);
  const dim = isDimLine(line);
  const text = displayTextForLine(line);

  return (
    <Box
      marginBottom={1}
      borderStyle="single"
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      borderLeft
      borderColor={borderColor}
      paddingLeft={1}
    >
      <Text wrap="wrap" dimColor={dim}>
        {text}
      </Text>
    </Box>
  );
}
