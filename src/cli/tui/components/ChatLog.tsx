import React from 'react';
import { Box } from 'ink';
import type { ChatLine } from '../types.js';
import { ChatMessageBlock } from './ChatMessageBlock.js';

interface ChatLogProps {
  lines: ChatLine[];
  streaming: boolean;
  streamBuf: string;
  thinkingBuf: string;
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
        <ChatMessageBlock key={`${i}-${line.role}-${line.toolKind ?? ''}`} line={line} />
      ))}
      {streaming && thinkingBuf ? (
        <ChatMessageBlock line={{ role: 'thinking', text: thinkingBuf }} />
      ) : null}
      {streaming && streamBuf ? (
        <ChatMessageBlock line={{ role: 'assistant', text: streamBuf }} />
      ) : null}
    </Box>
  );
}
