import type { CLIConfig } from '../types.js';

/** Max stdin size for headless `-p` (aligned with shell builtin cap). */
export const PRINT_STDIN_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Read piped stdin when not a TTY. Returns empty string on TTY.
 */
export async function readStdin(maxBytes = PRINT_STDIN_MAX_BYTES): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    process.stdin.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += buf.length;
      if (total > maxBytes) {
        process.stdin.destroy();
        reject(
          new Error(
            `stdin exceeds ${maxBytes} byte limit; write content to a file and reference it in the prompt`
          )
        );
        return;
      }
      chunks.push(buf);
    });

    process.stdin.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}

/**
 * Resolve the user prompt for `-p` from a positional argument and/or piped stdin.
 */
export async function resolvePrintPrompt(promptArg?: string | boolean): Promise<string> {
  const instruction = typeof promptArg === 'string' ? promptArg.trim() : '';
  const stdin = await readStdin();
  const stdinTrimmed = stdin.trim();

  if (instruction && stdinTrimmed) {
    return `${instruction}\n\n${stdin}`;
  }
  if (instruction) {
    return instruction;
  }
  if (stdinTrimmed) {
    return stdin;
  }

  throw new Error(
    'Missing prompt: pass text to -p/--print (e.g. agent-sdk -p "your task") or pipe stdin (e.g. cat log.txt | agent-sdk -p "summarize")'
  );
}

/**
 * Parse comma-separated tool names for `--allowed-tools`.
 */
export function parseAllowedTools(value: string): string[] {
  if (!value.trim()) {
    throw new Error('--allowed-tools requires at least one tool name');
  }
  const tools = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (tools.length === 0) {
    throw new Error('--allowed-tools requires at least one tool name');
  }
  return tools;
}

/**
 * Normalize output format from `-o` and `--output-format` (Claude Code alias).
 */
export function normalizeOutputFormat(options: CLIConfig): CLIConfig {
  const outputFormat = (options as CLIConfig & { outputFormat?: string }).outputFormat;
  const raw = outputFormat ?? options.output ?? 'text';
  if (raw !== 'text' && raw !== 'json') {
    throw new Error(`Invalid output format: ${raw} (use text or json)`);
  }
  return { ...options, output: raw };
}

/** True when running headless print mode (`-p` / `--print`). */
export function isHeadlessCli(options: CLIConfig): boolean {
  return options.print !== undefined;
}
