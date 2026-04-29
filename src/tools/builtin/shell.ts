import { spawn } from 'child_process';
import { z } from 'zod';
import { createTool } from '../registry.js';
import { getShellPath } from '../../core/environment.js';
import type { ToolDefinition } from '../../core/types.js';
import {
  installProcessExitCleanup,
  listBackgroundJobs,
  readJobOutput,
  spawnBackgroundJob,
  terminateJob
} from '../shell/process-manager.js';
import type { BashJobRecord } from '../shell/process-manager.js';

installProcessExitCleanup();

// Maximum output size (10MB) to prevent memory issues
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;
// Grace period before SIGKILL after SIGTERM (ms)
const KILL_DELAY = 5000;

/**
 * Bash 工具 - 执行 shell 命令（支持同步与后台运行）
 */
export const bashTool = createTool({
  name: 'Bash',
  category: 'shell',
  description: `Executes a bash command and returns its output.

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).

## Background execution
Set \`background: true\` for long-running commands such as dev servers, watchers, training jobs, or commands whose output should be checked later. Bash returns immediately with a \`jobId\`, process id, cwd, log file path, status, and an initial output preview. Use **BashOutput** with that \`jobId\` to read buffered output, **BashList** to inspect known jobs, and **BashKill** to terminate a job.

Background jobs are detached from the current tool call and can keep running after the agent turn is aborted. They remain in the in-memory job registry after exit by default so their final output can still be read. Set \`remove_job_on_exit: true\` only for fire-and-forget commands whose output does not need to be inspected after completion.

IMPORTANT: Avoid using this tool to run find, grep, cat, head, tail, sed, awk, or echo commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user:

 - File search: Use Glob (NOT find or ls)
 - Content search: Use Grep (NOT grep or rg)
 - Read files: Use Read (NOT cat/head/tail)
 - Edit files: Use Edit (NOT sed/awk)
 - Write files: Use Write (NOT echo >file)
 - Communication: Output text directly (NOT echo/printf)

# Instructions
- If your command will create new directories or files, first use this tool to run ls to verify the parent directory exists and it is the correct location
- Always quote file paths that contain spaces with double quotes in your command (e.g., cd "path with spaces/file.txt")
- If cwd is omitted, the command runs in the agent working directory when available
- Foreground: optional \`timeout\` in milliseconds (up to 600000ms / 10 minutes). Default 120000ms (2 minutes).
- Background: optional \`blockUntilMs\` waits briefly for startup output before returning.
- Background output is stored in bounded in-memory stdout/stderr ring buffers and mirrored to a temp log file when possible. If output exceeds the retained ring size, older in-memory output is trimmed; use the returned log path for full local diagnostics.`,
  parameters: z.object({
    command: z.string().describe('The command to execute'),
    description: z
      .string()
      .optional()
      .describe(
        'Clear, concise description of what this command does in active voice. Keep it brief (5-10 words).'
      ),
    cwd: z.string().optional().describe('Working directory for the command'),
    timeout: z
      .number()
      .int()
      .min(1)
      .max(600000)
      .optional()
      .describe('Foreground only: timeout in milliseconds (max 600000)'),
    background: z
      .boolean()
      .optional()
      .describe(
        'When true, start the command as a managed background job and return a job id instead of waiting for completion'
      ),
    blockUntilMs: z
      .number()
      .int()
      .min(0)
      .max(120_000)
      .optional()
      .describe(
        'Background only: wait up to this many ms after spawn before returning, useful for capturing startup logs or immediate failures. Default 0.'
      ),
    title: z
      .string()
      .optional()
      .describe('Background only: short human-readable label shown by BashList'),
    maxOutputBytes: z
      .number()
      .int()
      .min(4096)
      .max(50 * 1024 * 1024)
      .optional()
      .describe(
        'Background only: max characters retained in each in-memory stdout/stderr ring buffer. Default 2MiB per stream.'
      ),
    remove_job_on_exit: z
      .boolean()
      .optional()
      .describe(
        'Background only: when true, remove the job record as soon as the process exits. Default false keeps exited jobs available for BashList/BashOutput until BashKill or process cleanup.'
      )
  }),
  isDangerous: true,
  handler: async (
    {
      command,
      description: desc,
      cwd,
      timeout,
      background,
      blockUntilMs,
      title,
      maxOutputBytes,
      remove_job_on_exit
    },
    context
  ) => {
    if (background) {
      const job = await spawnBackgroundJob({
        command,
        shellPath: getShellPath(),
        cwd: cwd ?? context?.projectDir,
        env: { ...process.env },
        title,
        maxRingChars: maxOutputBytes,
        removeJobOnExit: remove_job_on_exit === true
      });

      let initial;
      if (blockUntilMs !== undefined && blockUntilMs > 0) {
        initial = await readJobOutput(job.id, { stream: 'all', waitMs: blockUntilMs });
      } else {
        initial = await readJobOutput(job.id, { stream: 'all' });
      }
      return formatBackgroundStart(job, desc, initial.content);
    }

    return await runForegroundBash({
      command,
      desc,
      cwd,
      timeout: timeout ?? 120000,
      signal: context?.signal,
      projectDir: context?.projectDir
    });
  }
});

function formatBackgroundStart(
  job: BashJobRecord,
  desc: string | undefined,
  initialRead: string
): { content: string } {
  const prefix = desc ? `[${desc}]\n` : '';
  return {
    content:
      `${prefix}Background bash job started.\n` +
      `jobId: ${job.id}\npid: ${job.pid ?? 'n/a'}\ncwd: ${job.cwd ?? '(default)'}\n` +
      `logFile: ${job.logFilePath ?? 'none'}\nstatus: ${job.status}\n` +
      `--- initial output preview (same format as BashOutput.content text, not the BashOutput tool JSON envelope) ---\n` +
      initialRead
  };
}

interface ForegroundOpts {
  command: string;
  desc?: string;
  cwd?: string;
  timeout: number;
  signal?: AbortSignal;
  projectDir?: string;
}

async function runForegroundBash(opts: ForegroundOpts): Promise<{ content: string; isError?: boolean }> {
  const { command, desc, cwd, timeout: effectiveTimeout, signal, projectDir } = opts;
  return new Promise((resolve) => {
    const shellPath = getShellPath();
    let stdout = '';
    let stderr = '';
    let outputTruncated = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const child = spawn(command, [], {
      shell: shellPath,
      cwd: cwd ?? projectDir,
      env: { ...process.env }
    });

    const onAbort = (): void => {
      if (settled) {
        return;
      }
      try {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, KILL_DELAY);
      } catch {
        // ignore
      }
      settled = true;
      resolve({
        content: `${desc ? `[${desc}]\n` : ''}Aborted before command finished`,
        isError: true
      });
    };

    const cleanupListener = (): void => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      child.kill('SIGTERM');

      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Process already exited
        }
      }, KILL_DELAY);

      child.once('exit', () => clearTimeout(killTimer));

      if (!settled) {
        settled = true;
        cleanupListener();
        resolve({
          content: `${desc ? `[${desc}]\n` : ''}Command timed out after ${effectiveTimeout}ms`,
          isError: true
        });
      }
    }, effectiveTimeout);

    child.stdout?.on('data', (data: Buffer) => {
      if (!outputTruncated && stdout.length < MAX_OUTPUT_SIZE) {
        stdout += data.toString();
        if (stdout.length >= MAX_OUTPUT_SIZE) {
          stdout += '\n[Output truncated due to size limit]';
          outputTruncated = true;
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      if (!outputTruncated && stderr.length < MAX_OUTPUT_SIZE) {
        stderr += data.toString();
        if (stderr.length >= MAX_OUTPUT_SIZE) {
          stderr += '\n[Output truncated due to size limit]';
          outputTruncated = true;
        }
      }
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      cleanupListener();
      resolve({
        content: `${desc ? `[${desc}]\n` : ''}Command failed: ${error.message}`,
        isError: true
      });
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      cleanupListener();
      const output: string[] = [];
      if (stdout) {
        output.push(stdout);
      }
      if (stderr) {
        output.push(`STDERR:\n${stderr}`);
      }

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

export const bashListTool = createTool({
  name: 'BashList',
  category: 'shell',
  description: `Lists background bash jobs started by Bash with \`background: true\`.

The result is a JSON array of job summaries including \`id\`, \`command\`, \`cwd\`, \`title\`, \`pid\`, \`status\`, \`runtimeMs\`, exit details, retained stdout/stderr sizes, and the temp log file path when available.

Use this before starting duplicate long-running commands and to discover jobs that need BashOutput or BashKill. The registry is in-memory and process-local; it only contains jobs known to this SDK process/tool instance, not arbitrary OS processes.`,
  parameters: z.object({}),
  isDangerous: false,
  handler: async () => {
    const rows = listBackgroundJobs();
    if (rows.length === 0) {
      return { content: 'No background bash jobs.' };
    }
    return { content: JSON.stringify(rows, null, 2) };
  }
});

export const bashOutputTool = createTool({
  name: 'BashOutput',
  category: 'shell',
  description: `Reads buffered output from a background bash job started by Bash with \`background: true\`.

Choose \`stream: "stdout"\`, \`"stderr"\`, or \`"all"\` (default). The response is JSON containing a human-readable \`content\` block plus status, exit info, next cursors, ring generations, and whether new output was observed.

For incremental reads, pass the returned cursor back into the next call. Use \`sinceCursor\` with a single stream, or \`sinceCursorStdout\` / \`sinceCursorStderr\` when tracking both streams independently. For \`stream: "all"\`, stdout and stderr are flattened into an approximate combined view; \`nextCursorCombinedApprox\` is reliable only when \`combinedCursorStale\` is false.

\`limitChars\` pages large output. \`tailChars\` returns only the newest characters. \`pattern\` filters matching lines with a JavaScript RegExp. Combining \`pattern\` or \`tailChars\` with \`stream: "all"\` makes the combined cursor stale, so prefer stdout/stderr streams for filtered polling.

Use \`waitMs\` to block locally until new output arrives, the process exits, or the wait expires. This is useful for polling long-running jobs without busy-looping.`,
  parameters: z.object({
    job_id: z.string().describe('Background job id returned by Bash'),
    stream: z
      .enum(['all', 'stdout', 'stderr'])
      .optional()
      .describe('Output stream to read. Default "all" returns an approximate stdout/stderr combined view.'),
    sinceCursor: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Read from this logical cursor for the selected stream. For stream "all", this offsets into the current combined snapshot.'
      ),
    sinceCursorStdout: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Read stdout from this logical cursor when tracking stdout independently'),
    sinceCursorStderr: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Read stderr from this logical cursor when tracking stderr independently'),
    tailChars: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Return only the newest N characters from the selected output after cursor/pattern processing'),
    limitChars: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Maximum characters to return in this read. Default 32000, capped internally at 2MiB.'),
    waitMs: z
      .number()
      .int()
      .min(0)
      .max(600_000)
      .optional()
      .describe('Wait up to this many ms for new output or process exit before returning'),
    pattern: z
      .string()
      .optional()
      .describe('Optional JavaScript regular expression; only matching output lines are kept')
  }),
  isDangerous: false,
  handler: async (args) =>
    readJobOutput(args.job_id, {
      stream: args.stream,
      sinceCursor: args.sinceCursor,
      sinceCursorStdout: args.sinceCursorStdout,
      sinceCursorStderr: args.sinceCursorStderr,
      tailChars: args.tailChars,
      limitChars: args.limitChars,
      waitMs: args.waitMs,
      pattern: args.pattern
    }).then((r) => ({ content: JSON.stringify(r, null, 2) }))
});

export const bashKillTool = createTool({
  name: 'BashKill',
  category: 'shell',
  description: `Terminates a background bash job started by Bash with \`background: true\`.

BashKill first sends SIGTERM, waits \`kill_delay_ms\` for graceful shutdown, then sends SIGKILL if the process is still registered. The job record is removed afterward, so later BashOutput calls for the same \`job_id\` will return \`not_found\`.

Use this for dev servers, watchers, hung commands, or any background job that should no longer consume resources.`,
  parameters: z.object({
    job_id: z.string().describe('Background job id returned by Bash'),
    kill_delay_ms: z
      .number()
      .int()
      .min(100)
      .max(60_000)
      .optional()
      .describe('Grace period in ms between SIGTERM and SIGKILL. Default 5000.')
  }),
  isDangerous: true,
  handler: async ({ job_id, kill_delay_ms }) => {
    const result = await terminateJob(job_id, 'SIGTERM', kill_delay_ms ?? 5000);
    return { content: JSON.stringify(result), isError: !result.ok };
  }
});

/**
 * 获取所有 Shell 工具
 */
export function getShellTools(): ToolDefinition[] {
  return [bashTool, bashListTool, bashOutputTool, bashKillTool];
}
