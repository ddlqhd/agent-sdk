/**
 * Charset detection and encode/decode helpers for builtin filesystem tools (Read / Write / Edit).
 */
import { analyse } from 'chardet';
import iconv from 'iconv-lite';

/** Bytes to read from file start for charset detection (larger samples reduce CJK mis-detection). */
const SAMPLE_BYTES = 64 * 1024;

/**
 * When chardet assigns equal confidence to several East Asian encodings (common on short samples),
 * we first prefer matches whose `lang` aligns with the encoding (see `langAffinityScore`), then fall
 * back to this order so GBK/GB18030 text is less often misread as Shift_JIS when still ambiguous.
 */
const CJK_TIE_BREAK_ORDER = [
  'GB18030',
  'Big5',
  'EUC-KR',
  'EUC-JP',
  'Shift_JIS'
] as const;

function cjkTieBreakRank(name: string): number {
  const i = CJK_TIE_BREAK_ORDER.indexOf(name as (typeof CJK_TIE_BREAK_ORDER)[number]);
  return i === -1 ? 100 : i;
}

/** Chardet labels for encodings we treat as East Asian multibyte (do not override with GB heuristic). */
function isCjkChardetName(name: string): boolean {
  switch (name) {
    case 'GB18030':
    case 'GBK':
    case 'Big5':
    case 'EUC-JP':
    case 'EUC-KR':
    case 'Shift_JIS':
    case 'ISO-2022-CN':
    case 'ISO-2022-JP':
    case 'ISO-2022-KR':
      return true;
    default:
      return false;
  }
}

/**
 * Counts plausible GBK/GB18030 double-byte pairs (lead 0x81–0xFE, trail 0x40–0x7E or 0x80–0xFE).
 * Used when chardet prefers a single-byte ISO/Windows encoding by a small margin over GB18030.
 */
function plausibleGbkDoubleBytePairCount(buf: Buffer): number {
  let n = 0;
  for (let i = 0; i < buf.length - 1; i++) {
    const a = buf[i]!;
    const b = buf[i + 1]!;
    if (a >= 0x81 && a <= 0xfe && b >= 0x40 && b <= 0xfe && b !== 0x7f) {
      n++;
      i++;
    }
  }
  return n;
}

/**
 * If the sample looks like GBK multibyte text but chardet ranks ISO-8859-* / windows-125* etc.
 * slightly higher than GB18030, prefer GB18030 (common for mixed ASCII + Chinese on Windows).
 */
function preferGb18030OverChardetTop(
  buf: Buffer,
  matches: Array<{ name: string; confidence: number; lang?: string }>
): boolean {
  if (matches.length === 0) return false;
  if (plausibleGbkDoubleBytePairCount(buf) < 2) return false;

  const top = matches[0];
  if (!top || isCjkChardetName(top.name)) return false;

  const maxConf = Math.max(...matches.map((m) => m.confidence));
  const gb = matches.find((m) => {
    const n = m.name as string;
    return n === 'GB18030' || n === 'GBK';
  });
  if (!gb) return false;

  const margin = 8;
  if (maxConf - gb.confidence > margin) return false;

  return true;
}

/**
 * Uses the whole sample as one UTF-8 byte sequence. If the file is damaged (UTF-8 then another
 * encoding), detection may still choose UTF-8 and the rest will look wrong — callers can pass an
 * explicit `encoding` on the Read tool to override.
 */
function isValidUtf8(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * When chardet gives the same confidence to several CJK encodings, use its optional `lang` hint
 * (zh / ja / ko) to prefer encodings that typically match that script before the static CJK order.
 */
function langAffinityScore(name: string, lang: string | undefined): number {
  if (!lang) return 0;
  const zhEnc = name === 'GB18030' || name === 'Big5';
  const jaEnc = name === 'Shift_JIS' || name === 'EUC-JP';
  if (zhEnc && lang === 'zh') return 2;
  if (jaEnc && lang === 'ja') return 2;
  if (name === 'EUC-KR' && lang === 'ko') return 2;
  if (zhEnc && (lang === 'ja' || lang === 'ko')) return -1;
  if (jaEnc && (lang === 'zh' || lang === 'ko')) return -1;
  if (name === 'EUC-KR' && (lang === 'zh' || lang === 'ja')) return -1;
  return 0;
}

/** BOM at file start → Node/iconv encoding name for reading. */
function encodingFromBom(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return 'utf8';
  }
  // UTF-32 BE / LE must be checked before UTF-16: FF FE is shared by UTF-16 LE and UTF-32 LE BOM.
  if (buf.length >= 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 0xfe && buf[3] === 0xff) {
    return 'utf-32be';
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xfe && buf[2] === 0 && buf[3] === 0) {
    return 'utf-32le';
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return 'utf16le';
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return 'utf-16be';
  }
  return null;
}

/** Map chardet encoding label to a value accepted by Node fs streams or iconv-lite. */
function chardetNameToReadEncoding(name: string): string | null {
  if (name === 'mbcs') return null;

  const table: Record<string, string> = {
    ASCII: 'utf8',
    'UTF-8': 'utf8',
    'UTF-16LE': 'utf16le',
    'UTF-16BE': 'utf-16be',
    'UTF-32LE': 'utf-32le',
    'UTF-32BE': 'utf-32be',
    'UTF-32': 'utf-32le',
    GB18030: 'gb18030',
    GBK: 'gbk',
    Big5: 'big5',
    'EUC-JP': 'euc-jp',
    'EUC-KR': 'euc-kr',
    Shift_JIS: 'shift_jis',
    'ISO-8859-1': 'latin1',
    'ISO-8859-2': 'latin2',
    'ISO-8859-5': 'iso88595',
    'ISO-8859-6': 'iso88596',
    'ISO-8859-7': 'iso88597',
    'ISO-8859-8': 'iso88598',
    'ISO-8859-9': 'latin5',
    'ISO-2022-CN': 'iso-2022-cn',
    'ISO-2022-JP': 'iso-2022-jp',
    'ISO-2022-KR': 'iso-2022-kr',
    ISO_2022: 'iso-2022-jp',
    'KOI8-R': 'koi8-r',
    'windows-1250': 'cp1250',
    'windows-1251': 'cp1251',
    'windows-1252': 'cp1252',
    'windows-1253': 'cp1253',
    'windows-1254': 'cp1254',
    'windows-1255': 'cp1255',
    'windows-1256': 'cp1256'
  };

  const mapped = table[name];
  if (mapped) {
    if (mapped === 'utf8' || mapped === 'utf16le' || mapped === 'latin1') {
      return mapped;
    }
    if (iconv.encodingExists(mapped)) {
      return mapped;
    }
  }

  const lower = name.toLowerCase().replace(/_/g, '-');
  if (lower !== 'mbcs' && iconv.encodingExists(lower)) {
    return lower;
  }

  const compact = name.replace(/-/g, '').toLowerCase();
  if (iconv.encodingExists(compact)) {
    return compact;
  }

  return null;
}

/**
 * Read the start of a file for charset detection (does not decode).
 */
export async function readEncodingSample(filePath: string, fileSize?: number): Promise<Buffer> {
  const fs = await import('fs/promises');
  const fh = await fs.open(filePath, 'r');
  try {
    const size = fileSize !== undefined ? fileSize : (await fh.stat()).size;
    const len = Math.min(SAMPLE_BYTES, size);
    if (len === 0) {
      return Buffer.alloc(0);
    }
    const buf = Buffer.allocUnsafe(len);
    const { bytesRead } = await fh.read(buf, 0, len, 0);
    return bytesRead < len ? buf.subarray(0, bytesRead) : buf;
  } finally {
    await fh.close();
  }
}

/**
 * Pick an encoding for reading: BOM → UTF-8 validity (whole sample) → chardet, with confidence
 * sort, then `lang` affinity, then CJK static tie-break. Mixed or pathological files may need a
 * manual `encoding` override.
 */
export function detectEncodingFromSample(buf: Buffer): string {
  if (buf.length === 0) {
    return 'utf8';
  }

  const bom = encodingFromBom(buf);
  if (bom) {
    return bom;
  }

  if (isValidUtf8(buf)) {
    return 'utf8';
  }

  const matches = analyse(buf).filter(
    (m) => m.confidence > 0 && m.name !== 'ASCII' && m.name !== 'mbcs'
  );

  matches.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    const langDiff = langAffinityScore(b.name, b.lang) - langAffinityScore(a.name, a.lang);
    if (langDiff !== 0) {
      return langDiff;
    }
    return cjkTieBreakRank(a.name) - cjkTieBreakRank(b.name);
  });

  if (preferGb18030OverChardetTop(buf, matches)) {
    const gb = matches.find((m) => {
      const n = m.name as string;
      return n === 'GB18030' || n === 'GBK';
    });
    if (gb) {
      const enc = chardetNameToReadEncoding(gb.name);
      if (enc && (isNativeReadEncoding(enc) || iconv.encodingExists(enc))) {
        return enc;
      }
    }
  }

  for (const m of matches) {
    const enc = chardetNameToReadEncoding(m.name);
    if (enc && (isNativeReadEncoding(enc) || iconv.encodingExists(enc))) {
      return enc;
    }
  }

  return 'utf8';
}

export function isNativeReadEncoding(enc: string): boolean {
  return enc === 'utf8' || enc === 'utf16le' || enc === 'latin1';
}

/**
 * Normalize user-supplied encoding for Read (explicit override), Write, and Edit:
 * empty/omitted → utf8; utf-8 → utf8; cp936 → gbk.
 */
export function normalizeFilesystemEncoding(encoding: string | undefined): string {
  const raw = encoding?.trim() ?? '';
  if (raw === '') return 'utf8';
  let e = raw.toLowerCase();
  if (e === 'utf-8') e = 'utf8';
  if (e === 'cp936') e = 'gbk';
  return e;
}

export function isFilesystemEncodingSupported(normalized: string): boolean {
  return isNativeReadEncoding(normalized) || iconv.encodingExists(normalized);
}

/**
 * Read a file as a JavaScript string using the given normalized encoding.
 */
export async function readFileAsUnicodeString(
  filePath: string,
  normalized: string
): Promise<string> {
  const fs = await import('fs/promises');
  if (isNativeReadEncoding(normalized)) {
    return fs.readFile(filePath, {
      encoding: normalized as 'utf8' | 'utf16le' | 'latin1'
    });
  }
  const buf = await fs.readFile(filePath);
  return iconv.decode(buf, normalized);
}

/**
 * Write a JavaScript string to a file using the given normalized encoding.
 */
export async function writeFileFromUnicodeString(
  filePath: string,
  text: string,
  normalized: string
): Promise<void> {
  const fs = await import('fs/promises');
  if (isNativeReadEncoding(normalized)) {
    await fs.writeFile(filePath, text, {
      encoding: normalized as 'utf8' | 'utf16le' | 'latin1'
    });
  } else {
    await fs.writeFile(filePath, iconv.encode(text, normalized));
  }
}
