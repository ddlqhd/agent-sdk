# Background Bash jobs

Built-in **`Bash`** can run commands in **managed background** mode instead of blocking until exit.

## Usage

1. **`Bash`** — set `background: true`. The tool returns promptly with **`jobId`**, **`pid`**, **`logFile`** (when available under the OS temp dir), and an optional initial buffered snapshot (see **`blockUntilMs`**).

2. **`BashOutput`** — read stdout/stderr or a deterministic **combined** view (`stream: all`). Prefer incremental reads using **`sinceCursor`** (offset into the combined snapshot; use **`nextCursorCombinedApprox`** from the previous **`BashOutput`** JSON). Raw paging applies **`limitChars`** to the merged slice before optional line filtering. If **`combinedCursorStale`** is **true** (because **`pattern`** or **`tailChars`** was used), do not chain **`sinceCursor`** on the combined stream—use **`stream: stdout`** / **`stderr`** or omit filters. Unknown job id returns **`status: not_found`**.

3. **`BashOutput.waitMs`** — waits locally for new bytes on stdout/stderr or process exit, reducing empty “poll-only” turns.

4. **`BashKill`** — stop the background process; the job entry is removed from the in-memory registry afterward (unless the job already disappeared, e.g. **`remove_job_on_exit`**).

5. **`Bash.remove_job_on_exit`** (optional) — when **true**, the job record is removed as soon as the child process exits (default **false**: keep the row for **`BashList`** / exit code until **`BashKill`**).

## Lifecycle notes

- **User / agent abort** (`AbortSignal`) applies to **foreground** `Bash` only; it terminates the spawned child. Background jobs **are not** aborted automatically when the agent run is aborted.

- **Process exit** — the SDK registers a one-shot cleanup hook (`installProcessExitCleanup`) that tries to terminate still-running background shells when the Node process shuts down unless `AGENT_SDK_NO_BASH_BG_CLEANUP` is set.

- **Retention** — output is retained in-memory with a ring-buffer cap per stream (defaults apply; optional `maxOutputBytes` on **`Bash`** raises the per-stream ring).

## Industry alignment

Similar to “session / process suite” tooling in coding-agent CLIs (list / read tail / kill) rather than relying on raw shell `&` or `tmux`; long silent waits should use **`waitMs`** on **`BashOutput`** instead of tight model loops.
