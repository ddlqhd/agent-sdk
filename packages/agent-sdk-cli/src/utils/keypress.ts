export interface KeyPressHandler {
  onAbort: () => void;
  onExit?: () => void;
}

let isActive = false;
let currentHandler: KeyPressHandler | null = null;
let paused = false;

const onKeypress = (chunk: string | Buffer) => {
  if (!isActive || !currentHandler) return;

  const key = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  if (key === '\x1b' || key.charCodeAt(0) === 27) {
    currentHandler.onAbort();
  }
  if (key === '\u0003') {
    currentHandler.onExit?.() || process.exit(130);
  }
};

export function initKeypressListener(): () => void {
  if (!process.stdin.isTTY) {
    return () => {};
  }

  if (isActive) {
    return () => {};
  }

  isActive = true;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  // Do not call setEncoding on stdin: readline's emitKeypressEvents uses its own decoder; mixing
  // string 'data' chunks with raw ESC handling breaks TTY input on some platforms after raw mode.
  process.stdin.on('data', onKeypress);

  return () => {
    if (!isActive) return;
    isActive = false;
    currentHandler = null;
    paused = false;

    process.stdin.off('data', onKeypress);
    try {
      process.stdin.setRawMode(false);
    } catch {
      // ignore
    }
    // Removing the last `data` listener can pause stdin; readline needs flowing mode (esp. Windows TTY).
    if (process.stdin.isPaused()) {
      process.stdin.resume();
    }
  };
}

export function setKeypressHandler(handler: KeyPressHandler): void {
  currentHandler = handler;
}

export function clearKeypressHandler(): void {
  currentHandler = null;
}

/**
 * CLI-only: release raw mode and the stdin `data` listener so line-based prompts
 * (e.g. AskUserQuestion) work while streaming. Pair with the returned resume function.
 */
export function pauseKeypressListener(): () => void {
  if (!process.stdin.isTTY || !isActive || paused) {
    return () => {};
  }

  paused = true;
  process.stdin.off('data', onKeypress);
  try {
    process.stdin.setRawMode(false);
  } catch {
    // ignore
  }
  if (process.stdin.isPaused()) {
    process.stdin.resume();
  }

  return () => {
    if (!paused) return;
    paused = false;
    if (!process.stdin.isTTY || !isActive) return;
    try {
      process.stdin.setRawMode(true);
    } catch {
      // ignore
    }
    process.stdin.on('data', onKeypress);
    if (process.stdin.isPaused()) {
      process.stdin.resume();
    }
  };
}
