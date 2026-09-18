import React from 'react';
import { Box, Text } from 'ink';
import {
  computeSlashMenuWindow,
  SLASH_MENU_MAX_VISIBLE,
  type SlashMenuItem
} from '../slash-menu.js';

interface SlashMenuProps {
  items: SlashMenuItem[];
  selectedIndex: number;
}

export function SlashMenu({ items, selectedIndex }: SlashMenuProps): React.ReactElement | null {
  if (items.length === 0) return null;

  const { start, end, above, below } = computeSlashMenuWindow(
    items.length,
    selectedIndex,
    SLASH_MENU_MAX_VISIBLE
  );
  const visible = items.slice(start, end);

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={0}>
      {above > 0 ? (
        <Text dimColor>↑ … +{above} above</Text>
      ) : null}
      {visible.map((item, i) => {
        const absoluteIndex = start + i;
        return (
          <Text key={item.key} color={absoluteIndex === selectedIndex ? 'cyan' : undefined}>
            {absoluteIndex === selectedIndex ? '> ' : '  '}
            <Text bold>{item.label}</Text>
            <Text dimColor> — {item.description}</Text>
          </Text>
        );
      })}
      {below > 0 ? (
        <Text dimColor>↓ … +{below} more</Text>
      ) : null}
    </Box>
  );
}
