import { randomUUID } from 'node:crypto';
import type { SpillTextResult } from '../environment.js';

/** Direct-return cap (~12k tokens). Aligns with SDK `OUTPUT_CONFIG.maxDirectOutput`. */
export const SPILL_MAX_DIRECT_CHARS = 50_000;
/** Max characters written to a spill file / accepted on `fs/spillText`. */
export const SPILL_MAX_STORAGE_CHARS = 10_000_000;
export const SPILL_SUMMARY_HEAD_LINES = 100;
export const SPILL_SUMMARY_TAIL_LINES = 100;

const SPILL_SUMMARY_MAX_CHARS = 8_000;

export function generateSpillSummary(content: string): string {
  const lines = content.split('\n');
  let summary: string;
  if (lines.length <= SPILL_SUMMARY_HEAD_LINES + SPILL_SUMMARY_TAIL_LINES) {
    summary = content;
  } else {
    const head = lines.slice(0, SPILL_SUMMARY_HEAD_LINES).join('\n');
    const tail = lines.slice(-SPILL_SUMMARY_TAIL_LINES).join('\n');
    const omitted = lines.length - SPILL_SUMMARY_HEAD_LINES - SPILL_SUMMARY_TAIL_LINES;
    summary = `${head}\n\n... (${omitted} lines omitted) ...\n\n${tail}`;
  }
  if (summary.length <= SPILL_SUMMARY_MAX_CHARS) {
    return summary;
  }
  const headChars = Math.floor(SPILL_SUMMARY_MAX_CHARS * 0.6);
  const tailChars = SPILL_SUMMARY_MAX_CHARS - headChars;
  return `${summary.slice(0, headChars)}\n\n... (truncated) ...\n\n${summary.slice(-tailChars)}`;
}

export function formatSpilledToolOutput(
  stored: string,
  storagePath: string,
  meta: { originalLength: number; lineCount: number; storageTruncated?: boolean }
): Omit<SpillTextResult, 'spilled' | 'storagePath'> & { content: string } {
  const sizeKB = (meta.originalLength / 1024).toFixed(1);
  const summary = generateSpillSummary(stored);
  const truncationNote = meta.storageTruncated
    ? ` Stored the first ${stored.length} of ${meta.originalLength} characters.`
    : '';
  return {
    content:
      `Output too large (${sizeKB} KB, ${meta.lineCount} lines)${truncationNote}\n\n` +
      `Summary:\n${summary}\n\n` +
      `Full output saved to: ${storagePath}\n` +
      `Use 'Read' with offset/limit to view specific sections.`,
    originalLength: meta.originalLength,
    lineCount: meta.lineCount,
    storageTruncated: meta.storageTruncated
  };
}

export function spillFileName(toolName: string, timestamp = Date.now()): string {
  const safeName = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safeName}-${timestamp}-${randomUUID()}.txt`;
}

/** True when spill wrote a file or replaced the payload with a truncated fallback. */
export function shouldReplaceWithSpill(spilled: SpillTextResult, original: string): boolean {
  return spilled.spilled || spilled.content !== original;
}
