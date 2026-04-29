import { spawn, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import { createWriteStream, type WriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Readable } from 'stream';

const DEFAULT_MAX_RING_CHARS = 2 * 1024 * 1024;

/** Single stream ring buffer with absolute logical indexing */
interface MessageRing {
  /** Last `tail` substring of output (possibly trimmed) */
  tail: string;
  /** Characters emitted lifetime (monotonic; increments on append) */
  emittedTotal: number;
}

export type BashJobStatus = 'running' | 'exited' | 'spawn_error' | 'not_found';

export interface BashSpawnOptions {
  command: string;
  shellPath: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  title?: string;
  maxRingChars?: number;
  /** When true, remove job from registry as soon as the child process exits (default false: keep for BashList/output until BashKill). */
  removeJobOnExit?: boolean;
  /** Optional explicit log dir; otherwise uses tmp/agent-sdk-bash-bg */
  logDir?: string | null;
}

export interface BashJobRecord {
  id: string;
  command: string;
  cwd?: string;
  title?: string;
  pid?: number;
  status: BashJobStatus;
  exitCode?: number | null;
  startedAtMs: number;
  endedAtMs?: number;
  spawnError?: string;
  stdout: MessageRing;
  stderr: MessageRing;
  ringGenerationStdout: number;
  ringGenerationStderr: number;
  /** Incremented whenever ring trims (invalidates persisted cursors older than emittedTotal-tail.length) — optional use */
  logFilePath?: string;
  child?: ChildProcess;
  /** When true, registry entry removed on successful process close */
  removeJobOnExit?: boolean;
}

// Process-local registry. Imported singleton tools share this map inside one Node.js
// process; separate SDK processes have independent registries.
const jobs = new Map<string, BashJobRecord>();

let cachedLogParent: string | null = null;

function createJobId(): string {
  return `bash_${randomBytes(12).toString('hex')}`;
}

async function resolveLogParent(logDir?: string | null): Promise<string | null> {
  if (logDir !== undefined && logDir !== null) {
    await mkdir(logDir, { recursive: true }).catch(() => {});
    return logDir || null;
  }
  if (cachedLogParent) {
    return cachedLogParent;
  }
  const dir = join(tmpdir(), 'agent-sdk-bash-bg');
  await mkdir(dir, { recursive: true }).catch(() => {});
  cachedLogParent = dir;
  return dir;
}

function append(ring: MessageRing, text: string, maxChars: number, onTrim: () => void): void {
  ring.emittedTotal += text.length;
  ring.tail += text;
  if (ring.tail.length > maxChars) {
    const cut = ring.tail.length - maxChars;
    ring.tail = ring.tail.slice(cut);
    onTrim();
  }
}

/** First logical index represented by current tail window */
function tailStartLogical(r: MessageRing): number {
  return r.emittedTotal - r.tail.length;
}

/**
 * Slice from absolute logical cursor `since` onward (characters already consumed upstream).
 */
function sliceFrom(ring: MessageRing, sinceLogical: number): string {
  if (sinceLogical >= ring.emittedTotal) {
    return '';
  }
  const start = tailStartLogical(ring);
  if (sinceLogical < start) {
    // Caller cursor predates trimmed head — invalidate
    return ring.tail;
  }
  const offset = Math.max(sinceLogical - start, 0);
  return ring.tail.slice(offset);
}

/** Deterministic concat for \"all\": stdout then STDERR block then stderr tail */
export function flattenCombined(job: BashJobRecord): string {
  let o = '';
  if (job.stdout.tail.length > 0) {
    o += job.stdout.tail;
  }
  if (job.stderr.tail.length > 0) {
    if (job.stdout.tail.length > 0) {
      o += '\nSTDERR:\n';
    } else {
      o += `STDERR:\n`;
    }
    o += job.stderr.tail;
  }
  return o;
}

function detachStreamListeners(readable?: Readable): void {
  if (readable && !readable.destroyed) {
    readable.removeAllListeners('data');
  }
}

function killChild(child?: ChildProcess, signal?: NodeJS.Signals): void {
  if (!child) {
    return;
  }
  try {
    child.kill(signal ?? ('SIGTERM' as NodeJS.Signals));
  } catch {
    // ignore
  }
}

async function finalizeLogWriter(ws?: WriteStream): Promise<void> {
  if (!ws || ws.writableEnded) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    ws.end(() => resolve());
    ws.once('error', reject);
  }).catch(() => {});
}

/**
 * Spawn a background bash job — returns immediately once child is created.
 */
export async function spawnBackgroundJob(options: BashSpawnOptions): Promise<BashJobRecord> {
  const id = createJobId();
  const maxRing = options.maxRingChars ?? DEFAULT_MAX_RING_CHARS;

  const stdout: MessageRing = { tail: '', emittedTotal: 0 };
  const stderr: MessageRing = { tail: '', emittedTotal: 0 };

  const job: BashJobRecord = {
    id,
    command: options.command,
    cwd: options.cwd,
    title: options.title,
    status: 'running',
    startedAtMs: Date.now(),
    stdout,
    stderr,
    ringGenerationStdout: 0,
    ringGenerationStderr: 0,
    removeJobOnExit: options.removeJobOnExit === true
  };

  jobs.set(id, job);

  let logWriter: WriteStream | undefined;
  const logParent = await resolveLogParent(options.logDir ?? undefined);

  try {
    if (logParent) {
      job.logFilePath = join(logParent, `${id}.log`);
      logWriter = createWriteStream(job.logFilePath, { flags: 'a' });
    }
  } catch {
    job.logFilePath = undefined;
  }

  const logLine = (line: string) => {
    if (logWriter && !logWriter.writableEnded) {
      logWriter.write(`${line.endsWith('\n') ? line : `${line}\n`}`);
    }
  };

  const child = spawn(options.command, [], {
    shell: options.shellPath,
    cwd: options.cwd,
    env: options.env ?? { ...process.env }
  });

  job.child = child;
  job.pid = child.pid ?? undefined;

  child.once('spawn', () => logLine(`# spawn bash job ${id} pid=${child.pid}`));

  child.on('error', (err) => {
    job.status = 'spawn_error';
    job.spawnError = err.message;
    job.endedAtMs = Date.now();
    void finalizeLogWriter(logWriter);
    job.child = undefined;
  });

  const onStdoutTrim = (): void => {
    job.ringGenerationStdout += 1;
  };

  const onStderrTrim = (): void => {
    job.ringGenerationStderr += 1;
  };

  child.stdout?.on('data', (data: Buffer) => {
    const t = data.toString();
    append(stdout, t, maxRing, onStdoutTrim);
    logLine(`[stdout] ${t.split(/\r?\n/).join('\n[stdout] ')}`);
  });

  child.stderr?.on('data', (data: Buffer) => {
    const t = data.toString();
    append(stderr, t, maxRing, onStderrTrim);
    logLine(`[stderr] ${t.split(/\r?\n/).join('\n[stderr] ')}`);
  });

  child.on('close', (code, signal) => {
    detachStreamListeners(child.stdout ?? undefined);
    detachStreamListeners(child.stderr ?? undefined);
    job.status = 'exited';
    job.exitCode = code ?? (signal ? 1 : null);
    job.endedAtMs = Date.now();
    logLine(`# close code=${code} signal=${signal ?? 'none'}`);
    void finalizeLogWriter(logWriter);
    job.child = undefined;
    if (job.removeJobOnExit) {
      jobs.delete(id);
    }
  });

  return job;
}

export function getBackgroundJob(id: string): BashJobRecord | undefined {
  return jobs.get(id);
}

export interface BashJobSummary {
  id: string;
  command: string;
  cwd?: string;
  title?: string;
  pid?: number;
  status: BashJobStatus;
  runtimeMs: number;
  exitCode?: number | null;
  spawnError?: string;
  stdoutRingChars: number;
  stderrRingChars: number;
  logFile?: string;
}

export function listBackgroundJobs(): BashJobSummary[] {
  const now = Date.now();
  const summaries: BashJobSummary[] = [];
  for (const j of jobs.values()) {
    const end = j.status === 'running' ? now : j.endedAtMs ?? now;
    summaries.push({
      id: j.id,
      command: j.command,
      cwd: j.cwd,
      title: j.title,
      pid: j.pid,
      status: j.status,
      runtimeMs: Math.max(0, end - j.startedAtMs),
      exitCode: j.status === 'exited' ? j.exitCode ?? null : undefined,
      spawnError: j.spawnError,
      stdoutRingChars: j.stdout.tail.length,
      stderrRingChars: j.stderr.tail.length,
      logFile: j.logFilePath
    });
  }
  return summaries.sort((a, b) => a.id.localeCompare(b.id));
}

export type BashOutputStream = 'stdout' | 'stderr' | 'all';

export interface BashReadOutputOptions {
  stream?: BashOutputStream;
  sinceCursorStdout?: number;
  sinceCursorStderr?: number;
  /** Convenience: when stream is stdout/stderr/all use sinceCursorUnified if set */
  sinceCursor?: number;
  tailChars?: number;
  limitChars?: number;
  waitMs?: number;
  pattern?: string;
}

export interface BashOutputResult {
  content: string;
  nextCursorStdout: number;
  nextCursorStderr: number;
  nextCursorCombinedApprox: number;
  /** When true, combined `sinceCursor` / `nextCursorCombinedApprox` are not reliable (pattern or tailChars was used); use stdout/stderr streams or read without filters. */
  combinedCursorStale?: boolean;
  status: BashJobStatus;
  newOutput: boolean;
  exited: boolean;
  exitCode?: number | null;
  suggestedWaitMs?: number;
  ringGenerationStdout: number;
  ringGenerationStderr: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Blocks up to waitMs waiting for stdout/stderr growth or process exit.
 */
async function waitForNewOutput(jobId: string, _opts: BashReadOutputOptions, waitMs: number): Promise<void> {
  const cap = Math.min(waitMs, 600_000);
  const deadline = Date.now() + cap;

  const j0 = getBackgroundJob(jobId);
  if (!j0 || j0.status !== 'running') {
    return;
  }

  const baselineOutEmitted = j0.stdout.emittedTotal;
  const baselineErrEmitted = j0.stderr.emittedTotal;

  while (Date.now() < deadline) {
    await sleep(Math.max(1, Math.min(100, deadline - Date.now())));
    const j = getBackgroundJob(jobId);
    if (!j || j.status !== 'running') {
      return;
    }
    if (j.stdout.emittedTotal !== baselineOutEmitted || j.stderr.emittedTotal !== baselineErrEmitted) {
      return;
    }
  }
}

/**
 * Line-safe regex filter without global-regexp lastIndex bleed across chunks.
 */
function filterLinesMatchingPattern(raw: string, pattern: string): string {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return raw;
  }
  try {
    return raw
      .split(/\r?\n/)
      .filter((line) => {
        const re = new RegExp(trimmed, 'm');
        return re.test(line);
      })
      .join('\n');
  } catch {
    return raw;
  }
}

export async function readJobOutput(jobId: string, opts?: BashReadOutputOptions): Promise<BashOutputResult> {
  let job = getBackgroundJob(jobId);
  if (!job) {
    return {
      content: `No background bash job "${jobId}"`,
      nextCursorStdout: 0,
      nextCursorStderr: 0,
      nextCursorCombinedApprox: 0,
      status: 'not_found',
      newOutput: false,
      exited: true,
      ringGenerationStdout: 0,
      ringGenerationStderr: 0
    };
  }

  const waitMs = opts?.waitMs ?? 0;
  if (waitMs > 0 && job.status === 'running') {
    await waitForNewOutput(jobId, opts ?? {}, waitMs);
    const jAfter = getBackgroundJob(jobId);
    if (!jAfter) {
      return {
        content: `No background bash job "${jobId}"`,
        nextCursorStdout: 0,
        nextCursorStderr: 0,
        nextCursorCombinedApprox: 0,
        status: 'not_found',
        newOutput: false,
        exited: true,
        ringGenerationStdout: 0,
        ringGenerationStderr: 0
      };
    }
    job = jAfter;
  }

  const stream = opts?.stream ?? 'all';

  const sinceStdout =
    opts?.sinceCursorStdout ??
    (stream === 'stdout'
      ? (opts?.sinceCursor ?? tailStartLogical(job.stdout))
      : tailStartLogical(job.stdout));

  const sinceStderr =
    opts?.sinceCursorStderr ??
    (stream === 'stderr'
      ? (opts?.sinceCursor ?? tailStartLogical(job.stderr))
      : tailStartLogical(job.stderr));

  let text = '';
  let combinedSliceStart = 0;
  let combinedCursorStale = false;
  let mergedForCombined: string | undefined;

  const effectiveLimitChars = Math.min(opts?.limitChars ?? 32_000, 2 * 1024 * 1024);

  let truncatedNote = '';

  if (stream === 'stdout') {
    text = sliceFrom(job.stdout, sinceStdout);
    if (opts?.pattern?.trim()) {
      text = filterLinesMatchingPattern(text, opts.pattern);
    }
    if (opts?.tailChars !== undefined && opts.tailChars > 0 && text.length > opts.tailChars) {
      text = text.slice(-opts.tailChars);
    }
    if (text.length > effectiveLimitChars) {
      truncatedNote = `\n...[truncated at ${effectiveLimitChars} chars]`;
      text = text.slice(0, effectiveLimitChars);
    }
  } else if (stream === 'stderr') {
    text = sliceFrom(job.stderr, sinceStderr);
    if (opts?.pattern?.trim()) {
      text = filterLinesMatchingPattern(text, opts.pattern);
    }
    if (opts?.tailChars !== undefined && opts.tailChars > 0 && text.length > opts.tailChars) {
      text = text.slice(-opts.tailChars);
    }
    if (text.length > effectiveLimitChars) {
      truncatedNote = `\n...[truncated at ${effectiveLimitChars} chars]`;
      text = text.slice(0, effectiveLimitChars);
    }
  } else {
    mergedForCombined = flattenCombined(job);
    let baseSince = opts?.sinceCursor ?? 0;
    if (baseSince < 0) {
      baseSince = 0;
    }
    combinedSliceStart = Math.min(baseSince, mergedForCombined.length);
    const rawMergedSlice = mergedForCombined.slice(combinedSliceStart);
    const rawLimited = rawMergedSlice.slice(0, effectiveLimitChars);

    const usedPattern = !!(opts?.pattern?.trim());
    const usedTail = !!(opts?.tailChars && opts.tailChars > 0);
    combinedCursorStale = usedPattern || usedTail;

    if (rawMergedSlice.length > effectiveLimitChars) {
      truncatedNote = `\n...[raw slice truncated at ${effectiveLimitChars} chars for paging]`;
    }

    text = rawLimited;
    if (usedPattern) {
      text = filterLinesMatchingPattern(text, opts?.pattern ?? '');
    }
    if (opts?.tailChars !== undefined && opts.tailChars > 0 && text.length > opts.tailChars) {
      text = text.slice(-opts.tailChars);
    }
  }

  const header = [
    `bash job: ${job.id}`,
    `status: ${job.status}`,
    `pid: ${job.pid ?? 'n/a'}`,
    stream === 'all'
      ? `combined view: stdout … STDERR banner … stderr (interleaving approximate)`
      : `stream: ${stream}`,
    `stderrEmittedTotal=${job.stderr.emittedTotal} stderrTailChars=${job.stderr.tail.length}`,
    `stdoutEmittedTotal=${job.stdout.emittedTotal} stdoutTailChars=${job.stdout.tail.length}`,
    stream === 'all' && combinedCursorStale ? 'combinedCursorStale=true (pattern/tail breaks sinceCursor; use stream stdout/stderr or omit filters)' : null,
    exitedLine(job),
    truncatedNote ? truncatedNote.trim() : null,
    '',
    '--- output ---'
  ]
    .filter(Boolean)
    .join('\n');

  const exited = job.status !== 'running';
  const newOutput = Boolean(text.trim().length || exited);

  const mergedNow = flattenCombined(job);

  const nextStdoutAdv =
    stream === 'stdout'
      ? sinceStdout + sliceFrom(job.stdout, sinceStdout).length
      : job.stdout.emittedTotal;

  const nextStderrAdv =
    stream === 'stderr'
      ? sinceStderr + sliceFrom(job.stderr, sinceStderr).length
      : job.stderr.emittedTotal;

  let nextCursorCombinedApprox: number;
  if (stream !== 'all') {
    nextCursorCombinedApprox = mergedNow.length;
  } else if (!mergedForCombined) {
    nextCursorCombinedApprox = mergedNow.length;
  } else if (combinedCursorStale) {
    nextCursorCombinedApprox = mergedNow.length;
  } else {
    const rawMergedSlice = mergedForCombined.slice(combinedSliceStart);
    const rawLimited = rawMergedSlice.slice(0, effectiveLimitChars);
    nextCursorCombinedApprox = combinedSliceStart + rawLimited.length;
  }

  return {
    content: `${header}\n${text}`,
    nextCursorStdout: Math.min(nextStdoutAdv, job.stdout.emittedTotal),
    nextCursorStderr: Math.min(nextStderrAdv, job.stderr.emittedTotal),
    nextCursorCombinedApprox,
    combinedCursorStale: stream === 'all' ? combinedCursorStale : undefined,
    status: job.status,
    newOutput,
    exited,
    exitCode: exited ? job.exitCode : undefined,
    suggestedWaitMs: job.status === 'running' ? Math.min(waitMs || 1500, 30_000) : undefined,
    ringGenerationStdout: job.ringGenerationStdout,
    ringGenerationStderr: job.ringGenerationStderr
  };
}

function exitedLine(job: BashJobRecord): string {
  if (job.status === 'exited') {
    return `exitCode=${job.exitCode}`;
  }
  if (job.status === 'spawn_error') {
    return `spawnError=${job.spawnError ?? 'unknown'}`;
  }
  return 'running=true';
}

export async function terminateJob(
  id: string,
  signal?: NodeJS.Signals,
  killDelayMs?: number
): Promise<{ ok: boolean; message: string }> {
  const entry = getBackgroundJob(id);
  if (!entry) {
    return { ok: false, message: `No job "${id}"` };
  }

  const proc = entry.child;

  killChild(proc, signal ?? 'SIGTERM');

  await new Promise<void>((resolve) => {
    const deadline = killDelayMs ?? 5000;
    const timer = setTimeout(() => resolve(), deadline);
    if (!proc) {
      clearTimeout(timer);
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    proc.once('close', done);
    proc.once('exit', done);
  });

  const again = getBackgroundJob(id);
  if (!again) {
    return { ok: true, message: `Job ${id} already ended or removed` };
  }

  try {
    killChild(again.child, 'SIGKILL');
  } catch {
    // Process already exited
  }

  jobs.delete(id);

  return { ok: true, message: `Job ${id} terminated` };
}

/**
 * Removes completed jobs older than TTL (cleanup). Optional idle GC.
 */
export function deleteJob(id: string): boolean {
  return jobs.delete(id);
}

export function jobCount(): number {
  return jobs.size;
}

export function disposeAllJobs(): void {
  for (const [, j] of jobs) {
    try {
      j.child?.kill('SIGKILL');
    } catch {
      // ignore
    }
    j.child?.removeAllListeners();
  }
  jobs.clear();
}

/** Register SIGINT/EXIT to avoid orphan shells on SDK process exit — call once when module loads (optional via shell.ts) */
let exitHookInstalled = false;
export function installProcessExitCleanup(): void {
  if (exitHookInstalled || process.env.AGENT_SDK_NO_BASH_BG_CLEANUP) {
    return;
  }
  exitHookInstalled = true;

  const onExit = (): void => {
    disposeAllJobs();
  };

  process.once('beforeExit', onExit);
  process.once('exit', onExit);
}
