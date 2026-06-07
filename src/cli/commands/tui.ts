import { Command } from 'commander';
import chalk from 'chalk';
import type { CLIConfig } from '../types.js';
import { addModelOptions } from '../utils/agent-bootstrap.js';

/**
 * Full-screen Ink TUI (optional: ink + react).
 */
export function createTuiCommand(): Command {
  return addModelOptions(
    new Command('tui').description(
      'Start full-screen terminal UI (requires ink and react: pnpm add ink react)'
    )
  ).action(async (options: CLIConfig) => {
    try {
      const { runTui } = await import('../tui/index.js');
      await runTui(options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : '';
      if (
        code === 'ERR_MODULE_NOT_FOUND' ||
        msg.includes("Cannot find package 'ink'") ||
        msg.includes("Cannot find module 'ink'") ||
        msg.includes("Cannot find package 'react'")
      ) {
        console.error(
          chalk.red('Missing optional dependencies for TUI. Install with:\n  pnpm add ink react')
        );
        process.exit(1);
      }
      console.error(chalk.red(`Error: ${msg}`));
      process.exit(1);
    }
  });
}
