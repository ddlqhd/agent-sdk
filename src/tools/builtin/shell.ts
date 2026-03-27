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
 * Bash 命令执行工具
 */
export const bashTool = createTool({
  name: 'bash',
  category: 'shell',
  description:
    'Executes a given shell command in a persistent session. Use this tool to run system commands, install packages, compile code, or perform any operation that requires a shell. Each command runs in a separate process. Provide a short description of what the command does to help with debugging.',
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    description: z
      .string()
      .optional()
      .describe('Clear 5-10 word description of what the command does'),
    cwd: z.string().optional().describe('Working directory for the command'),
    timeout: z
      .number()
      .optional()
      .default(120000)
      .describe('Timeout in milliseconds (default: 120000)'),
    env: z
      .record(z.string())
      .optional()
      .describe('Additional environment variables to set')
  }),
  isDangerous: true,
  handler: async ({ command, description: desc, cwd, timeout, env }) => {
    return new Promise((resolve) => {
      const shellPath = getShellPath();
      let stdout = '';
      let stderr = '';
      let outputTruncated = false;

      const child = spawn(command, [], {
        shell: shellPath,
        cwd,
        env: { ...process.env, ...env },
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
          content: `${desc ? `[${desc}]\n` : ''}Command timed out after ${timeout}ms`,
          isError: true
        });
      }, timeout);

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
