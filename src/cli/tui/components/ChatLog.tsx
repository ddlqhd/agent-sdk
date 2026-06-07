import React from 'react';
import { Box, Text } from 'ink';
import type { ChatLine } from '../types.js';

interface ChatLogProps {
  lines: ChatLine[];
  streaming: boolean;
  streamBuf: string;
  thinkingBuf: string;
}

function linePrefix(role: ChatLine['role']): string {
  if (role === 'thinking') return '💭 ';
  if (role === 'tool') return '';
  return `${role}: `;
}

function lineColor(role: ChatLine['role']): 'green' | 'blue' | 'gray' | 'yellow' | undefined {
  if (role === 'user') return 'green';
  if (role === 'assistant') return 'blue';
  if (role === 'thinking') return 'gray';
  if (role === 'tool') return 'yellow';
  return 'gray';
}

export function ChatLog({
  lines,
  streaming,
  streamBuf,
  thinkingBuf
}: ChatLogProps): React.ReactElement {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      {lines.map((line, i) => (
        <Text key={`${i}-${line.role}`} wrap="wrap">
          <Text color={lineColor(line.role)}>{linePrefix(line.role)}</Text>
          <Text dimColor={line.role === 'thinking'}>{line.text}</Text>
        </Text>
      ))}
      {streaming && thinkingBuf ? (
        <Text wrap="wrap">
          <Text color="gray">💭 </Text>
          <Text dimColor>{thinkingBuf}</Text>
        </Text>
      ) : null}
      {streaming && streamBuf ? (
        <Text wrap="wrap">
          <Text color="blue">assistant: </Text>
          {streamBuf}
        </Text>
      ) : null}
    </Box>
  );
}
