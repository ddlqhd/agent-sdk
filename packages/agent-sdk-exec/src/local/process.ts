import { spawn } from 'node:child_process';
import { assertWithinRoot } from '../path-guard.js';
import type {
  FileSystem,
  ProcessHandle,
  ProcessListItem,
  ProcessReadOptions,
  ProcessReadResult,
  ProcessRuntime,
  ProcessStartRequest,
  ProcessTerminateResult,
  ProcessWaitResult
} from '../environment.js';
import { buildShellInvocation } from './invocation.js';
import {
  getBackgroundJob,
  installProcessExitCleanup,
  listBackgroundJobs,
  readJobOutput,
  spawnBackgroundJob,
  terminateJob,
  writeJobStdin,
  type BashJobRecord
} from './process-manager.js';
import { getExecutorShellPath } from './shell-path.js';
import { shouldReplaceWithSpill } from './spill.js';

const DEFAULT_MAX_OUTPUT = 10 * 1024 * 1024;
const KILL_DELAY = 5000;

function mergeExecutorEnv(overrides?: Record<string, string>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env };
  if (overrides) {
    Object.assign(base, overrides);
  }
  return base;
}

async function applyWaitSpill(
  fs: FileSystem | undefined,
  result: ProcessWaitResult
): Promise<ProcessWaitResult> {
  if (!fs) {
    return result;
  }
  const parts: string[] = [];
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(`STDERR:\n${result.stderr}`);
  const combined = parts.join('\n');
  if (!combined) {
    return result;
  }
  const spilled = await fs.spillText(combined, { toolName: 'Bash' });
  if (!shouldReplaceWithSpill(spilled, combined)) {
    return result;
  }
  return {
    ...result,
    stdout: spilled.content,
    stderr: '',
    storagePath: spilled.storagePath
  };
}

async function applyReadSpill(
  fs: FileSystem | undefined,
  result: ProcessReadResult,
  opts?: ProcessReadOptions
): Promise<ProcessReadResult> {
  if (!fs || opts?.raw) {
    return result;
  }
  const spilled = await fs.spillText(result.content, { toolName: 'BashOutput' });
  if (!shouldReplaceWithSpill(spilled, result.content)) {
    return result;
  }
  return {
    ...result,
    content: spilled.content,
    storagePath: spilled.storagePath
  };
}

function jobToHandle(job: BashJobRecord, fs?: FileSystem): ProcessHandle {
  return {
    id: job.id,
    pid: job.pid,
    command: job.command,
    cwd: job.cwd,
    title: job.title,
    status: job.status,
    logFilePath: job.logFilePath,
    async wait(opts): Promise<ProcessWaitResult> {
      return applyWaitSpill(fs, await waitForJob(job.id, opts));
    },
    async read(opts?: ProcessReadOptions): Promise<ProcessReadResult> {
      return applyReadSpill(fs, await readJobOutput(job.id, opts), opts);
    },
    async write(data: Uint8Array): Promise<void> {
      await writeJobStdin(job.id, data);
    },
    async signal(sig?: NodeJS.Signals): Promise<void> {
      try {
        job.child?.kill(sig ?? 'SIGTERM');
      } catch {
        // ignore
      }
    },
    async terminate(opts?: { killDelayMs?: number }): Promise<ProcessTerminateResult> {
      return terminateJob(job.id, 'SIGTERM', opts?.killDelayMs ?? KILL_DELAY);
    }
  };
}

async function waitForJob(
    id: string,
    opts?: { timeoutMs?: number; signal?: AbortSignal; maxOutputBytes?: number }
  ): Promise<ProcessWaitResult> {
    const timeoutMs = opts?.timeoutMs ?? 120_000;
    const maxOutput = opts?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (opts?.signal?.aborted) {
        await terminateJob(id, 'SIGTERM', KILL_DELAY);
        return { stdout: '', stderr: '', exitCode: null, timedOut: false, aborted: true };
      }
      const current = getBackgroundJob(id);
      if (!current || current.status !== 'running') {
        const out = await readJobOutput(id, { stream: 'all', limitChars: maxOutput });
        return {
          stdout: out.content,
          stderr: '',
          exitCode: current?.exitCode ?? null,
          timedOut: false,
          aborted: false,
          spawnError: current?.spawnError
        };
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    await terminateJob(id, 'SIGTERM', KILL_DELAY);
    return { stdout: '', stderr: '', exitCode: null, timedOut: true, aborted: false };
}

export class LocalProcessRuntime implements ProcessRuntime {
  constructor(
    private readonly workspaceRoot?: string,
    private readonly fs?: FileSystem
  ) {
    installProcessExitCleanup();
  }

  private resolveCwd(cwd?: string): string | undefined {
    if (!cwd) {
      return this.workspaceRoot;
    }
    return assertWithinRoot(this.workspaceRoot, cwd);
  }

  async start(req: ProcessStartRequest): Promise<ProcessHandle> {
    const cwd = this.resolveCwd(req.cwd);
    const shellPath = req.shellPath ?? getExecutorShellPath();
    const env = req.replaceEnv === true ? { ...(req.env ?? {}) } : mergeExecutorEnv(req.env);
    const pipeStdin = req.pipeStdin === true;

    if (req.background) {
      const job = await spawnBackgroundJob({
        command: req.command,
        args: req.args,
        shellPath,
        cwd,
        env,
        title: req.title,
        maxRingChars: req.maxRingChars,
        removeJobOnExit: req.removeJobOnExit === true,
        pipeStdin
      });
      return jobToHandle(job, this.fs);
    }

    return startForeground(req.command, shellPath, cwd, env, {
      args: req.args,
      pipeStdin,
      fs: this.fs
    });
  }

  async listJobs(): Promise<ProcessListItem[]> {
    return listBackgroundJobs();
  }

  async getJob(id: string): Promise<ProcessHandle | undefined> {
    const job = getBackgroundJob(id);
    return job ? jobToHandle(job, this.fs) : undefined;
  }
}

function startForeground(
  command: string,
  shellPath: string,
  cwd: string | undefined,
  env: NodeJS.ProcessEnv,
  options: { args?: string[]; pipeStdin: boolean; fs?: FileSystem } = { pipeStdin: false }
): ProcessHandle {
  const invocation =
    options.args !== undefined
      ? { file: command, args: options.args, windowsVerbatimArguments: false }
      : buildShellInvocation(command, shellPath);
  const child = spawn(invocation.file, invocation.args, {
    cwd,
    env,
    stdio: options.pipeStdin ? ['pipe', 'pipe', 'pipe'] : undefined,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments
  });

  let stdout = '';
  let stderr = '';
  let outputTruncated = false;
  let exitCode: number | null = null;
  let spawnError: string | undefined;
  let closed = false;
  const waiters: Array<() => void> = [];

  const notify = (): void => {
    for (const w of waiters) w();
    waiters.length = 0;
  };

  child.stdout?.on('data', (data: Buffer) => {
    if (!outputTruncated && stdout.length < DEFAULT_MAX_OUTPUT) {
      stdout += data.toString();
      if (stdout.length >= DEFAULT_MAX_OUTPUT) {
        stdout += '\n[Output truncated due to size limit]';
        outputTruncated = true;
      }
    }
  });
  child.stderr?.on('data', (data: Buffer) => {
    if (!outputTruncated && stderr.length < DEFAULT_MAX_OUTPUT) {
      stderr += data.toString();
      if (stderr.length >= DEFAULT_MAX_OUTPUT) {
        stderr += '\n[Output truncated due to size limit]';
        outputTruncated = true;
      }
    }
  });
  child.on('error', (error) => {
    spawnError = error.message;
    closed = true;
    notify();
  });
  child.on('close', (code) => {
    exitCode = code;
    closed = true;
    notify();
  });

  const handle: ProcessHandle = {
    id: `fg_${child.pid ?? Date.now()}`,
    pid: child.pid,
    command,
    cwd,
    status: 'running',
    async wait(opts): Promise<ProcessWaitResult> {
      const timeoutMs = opts?.timeoutMs ?? 120_000;
      if (opts?.signal?.aborted) {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, KILL_DELAY);
        return { stdout, stderr, exitCode: null, timedOut: false, aborted: true };
      }

      const raw = await new Promise<ProcessWaitResult>((resolve) => {
        let settled = false;
        const finish = (result: ProcessWaitResult): void => {
          if (settled) return;
          settled = true;
          if (opts?.signal) {
            opts.signal.removeEventListener('abort', onAbort);
          }
          clearTimeout(timer);
          resolve(result);
        };

        const onAbort = (): void => {
          try {
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
          finish({ stdout, stderr, exitCode: null, timedOut: false, aborted: true });
        };

        if (opts?.signal) {
          opts.signal.addEventListener('abort', onAbort, { once: true });
        }

        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          const killTimer = setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore
            }
          }, KILL_DELAY);
          child.once('exit', () => clearTimeout(killTimer));
          finish({ stdout, stderr, exitCode: null, timedOut: true, aborted: false });
        }, timeoutMs);

        if (closed) {
          finish({
            stdout,
            stderr,
            exitCode,
            timedOut: false,
            aborted: false,
            spawnError
          });
          return;
        }
        waiters.push(() => {
          finish({
            stdout,
            stderr,
            exitCode,
            timedOut: false,
            aborted: false,
            spawnError
          });
        });
      });
      return applyWaitSpill(options.fs, raw);
    },
    async read(opts?: ProcessReadOptions): Promise<ProcessReadResult> {
      const stream = opts?.stream ?? 'all';
      const rawStdout = stream === 'stderr' ? '' : stdout;
      const rawStderr = stream === 'stdout' ? '' : stderr;
      const content =
        stream === 'stdout'
          ? rawStdout
          : stream === 'stderr'
            ? rawStderr
            : opts?.raw
              ? stdout + stderr
              : stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
      return applyReadSpill(
        options.fs,
        {
          content,
          nextCursorStdout: stdout.length,
          nextCursorStderr: stderr.length,
          nextCursorCombinedApprox: stdout.length + stderr.length,
          status: closed ? (spawnError ? 'spawn_error' : 'exited') : 'running',
          newOutput: Boolean(stdout || stderr),
          exited: closed,
          exitCode: closed ? exitCode : undefined,
          ringGenerationStdout: 0,
          ringGenerationStderr: 0
        },
        opts
      );
    },
    async write(data: Uint8Array): Promise<void> {
      if (!options.pipeStdin) {
        throw new Error('Process was not started with pipeStdin');
      }
      const stdin = child.stdin;
      if (!stdin || stdin.destroyed || stdin.writableEnded) {
        throw new Error('Process stdin is closed');
      }
      await new Promise<void>((resolve, reject) => {
        stdin.write(Buffer.from(data), (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },
    async signal(sig?: NodeJS.Signals): Promise<void> {
      try {
        child.kill(sig ?? 'SIGTERM');
      } catch {
        // ignore
      }
    },
    async terminate(opts?: { killDelayMs?: number }): Promise<ProcessTerminateResult> {
      try {
        child.kill('SIGTERM');
      } catch {
        return { ok: false, message: 'Process already exited' };
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, opts?.killDelayMs ?? KILL_DELAY);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      return { ok: true, message: 'Process terminated' };
    }
  };

  return handle;
}
