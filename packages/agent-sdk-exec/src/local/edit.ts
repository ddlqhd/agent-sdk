/** Edit loads the full file into memory; reject at or above this size (bytes). */
export const EDIT_MAX_FILE_BYTES = 1024 ** 3;

/** Execution-plane Edit errors already include a stable, user-facing prefix. */
export function formatEditToolError(message: string): string {
  if (
    message.startsWith('Error:') ||
    message.startsWith('old_string ') ||
    message.startsWith('Found ')
  ) {
    return message;
  }
  return `Error editing file: ${message}`;
}

export function detectDominantEol(content: string): '\r\n' | '\n' {
  let crlf = 0;
  for (let i = 0; i < content.length - 1; i++) {
    if (content[i] === '\r' && content[i + 1] === '\n') {
      crlf++;
    }
  }
  let nl = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      nl++;
    }
  }
  const bareLf = nl - crlf;
  if (crlf > bareLf) {
    return '\r\n';
  }
  return '\n';
}

export function normalizeNewStringEols(text: string, eol: '\r\n' | '\n'): string {
  const unified = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (eol === '\n') {
    return unified;
  }
  return unified.replace(/\n/g, '\r\n');
}

export function buildNeedleCandidates(oldString: string, dominantEol: '\r\n' | '\n'): string[] {
  const out: string[] = [oldString];
  if (dominantEol === '\r\n') {
    if (!oldString.includes('\r')) {
      const v = oldString.replace(/\n/g, '\r\n');
      if (v !== oldString) {
        out.push(v);
      }
    }
  } else {
    if (oldString.includes('\r\n')) {
      const v = oldString.replace(/\r\n/g, '\n');
      if (v !== oldString) {
        out.push(v);
      }
    } else if (oldString.includes('\r')) {
      const v = oldString.replace(/\r/g, '\n');
      if (v !== oldString) {
        out.push(v);
      }
    }
  }
  return out;
}

export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let n = 0;
  let from = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, from)) !== -1) {
    n++;
    from = i + needle.length;
  }
  return n;
}

export function replaceNonOverlapping(
  content: string,
  needle: string,
  replacement: string,
  replaceAll: boolean
): string {
  if (!replaceAll) {
    const i = content.indexOf(needle);
    if (i === -1) {
      throw new Error('Edit: needle not found after resolution (internal inconsistency)');
    }
    return content.slice(0, i) + replacement + content.slice(i + needle.length);
  }
  let out = '';
  let from = 0;
  let i = 0;
  while ((i = content.indexOf(needle, from)) !== -1) {
    out += content.slice(from, i) + replacement;
    from = i + needle.length;
  }
  out += content.slice(from);
  return out;
}
