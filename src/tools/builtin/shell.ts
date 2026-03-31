import { spawn } from 'child_process';
import { z } from 'zod';
import { createTool } from '../registry.js';
import { getShellPath } from '../../core/environment.js';
import type { ToolDefinition } from '../../core/types.js';

// Maximum output size (10MB) to prevent memory issues
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;
// Grace period before SIGKILL after SIGTERM (ms)
const KILL_DELAY = 5000;

/**
 * Bash 工具 - 执行 shell 命令
 */
export const bashTool = createTool({
  name: 'Bash',
  category: 'shell',
  description: `Executes a given bash command and returns its output.

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).

IMPORTANT: Avoid using this tool to run find, grep, cat, head, tail, sed, awk, or echo commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user:

 - File search: Use Glob (NOT find or ls)
 - Content search: Use Grep (NOT grep or rg)
 - Read files: Use Read (NOT cat/head/tail)
 - Edit files: Use Edit (NOT sed/awk)
 - Write files: Use Write (NOT echo >file)
 - Communication: Output text directly (NOT echo/printf)

# Instructions
- If your command will create new directories or files, first use this tool to run ls to verify the parent directory exists and is the correct location
- Always quote file paths that contain spaces with double quotes in your command (e.g., cd "path with spaces/file.txt")
- If cwd is omitted, the command runs in the agent working directory when available
- You may specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). By default, your command will timeout after 120000ms (2 minutes).`,
  parameters: z.object({
    command: z.string().describe('The command to execute'),
    description: z
      .string()
      .optional()
      .describe('Clear, concise description of what this command does in active voice. Keep it brief (5-10 words).'),
    cwd: z.string().optional().describe('Working directory for the command'),
    timeout: z
      .number()
      .int()
      .min(1)
      .max(600000)
      .optional()
      .describe('Optional timeout in milliseconds (max 600000)')
  }),
  isDangerous: true,
  handler: async ({ command, description: desc, cwd, timeout }, context) => {
    return new Promise((resolve) => {
      const shellPath = getShellPath();
      let stdout = '';
      let stderr = '';
      let outputTruncated = false;
      const effectiveTimeout = timeout ?? 120000;

      const child = spawn(command, [], {
        shell: shellPath,
        cwd: cwd ?? context?.projectDir,
        env: { ...process.env },
      });

      const timer = setTimeout(() => {
        // Try SIGTERM first, then SIGKILL if process doesn't exit
        child.kill('SIGTERM');

        const killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Process already exited
          }
        }, KILL_DELAY);

        // Clean up kill timer if process exits
        child.on('exit', () => clearTimeout(killTimer));

        resolve({
          content: `${desc ? `[${desc}]\n` : ''}Command timed out after ${effectiveTimeout}ms`,
          isError: true
        });
      }, effectiveTimeout);

      child.stdout.on('data', (data) => {
        if (!outputTruncated && stdout.length < MAX_OUTPUT_SIZE) {
          stdout += data.toString();
          if (stdout.length >= MAX_OUTPUT_SIZE) {
            stdout += '\n[Output truncated due to size limit]';
            outputTruncated = true;
          }
        }
      });

      child.stderr.on('data', (data) => {
        if (!outputTruncated && stderr.length < MAX_OUTPUT_SIZE) {
          stderr += data.toString();
          if (stderr.length >= MAX_OUTPUT_SIZE) {
            stderr += '\n[Output truncated due to size limit]';
            outputTruncated = true;
          }
        }
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({
          content: `${desc ? `[${desc}]\n` : ''}Command failed: ${error.message}`,
          isError: true
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const output: string[] = [];
        if (stdout) output.push(stdout);
        if (stderr) output.push(`STDERR:\n${stderr}`);

        const prefix = desc ? `[${desc}]\n` : '';
        if (code === 0) {
          resolve({
            content: prefix + (output.join('\n') || 'Command executed successfully (no output)')
          });
        } else {
          resolve({
            content: `${prefix}Command failed (exit code ${code})\n${output.join('\n')}`,
            isError: true
          });
        }
      });
    });
  }
});

/**
 * 获取所有 Shell 工具
 */
export function getShellTools(): ToolDefinition[] {
  return [bashTool];
}
