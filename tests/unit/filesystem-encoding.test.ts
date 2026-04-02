import { describe, expect, it } from 'vitest';
import { detectEncodingFromSample } from '../../src/tools/builtin/filesystem-encoding.js';

describe('detectEncodingFromSample BOM handling', () => {
  it('detects UTF-32 LE BOM before UTF-16 LE (FF FE 00 00)', () => {
    const buf = Buffer.from([0xff, 0xfe, 0, 0]);
    expect(detectEncodingFromSample(buf)).toBe('utf-32le');
  });

  it('detects UTF-32 BE BOM (00 00 FE FF)', () => {
    const buf = Buffer.from([0, 0, 0xfe, 0xff]);
    expect(detectEncodingFromSample(buf)).toBe('utf-32be');
  });

  it('detects UTF-16 LE when only FF FE (2 bytes)', () => {
    const buf = Buffer.from([0xff, 0xfe]);
    expect(detectEncodingFromSample(buf)).toBe('utf16le');
  });

  it('detects UTF-16 LE when FF FE is not followed by 00 00', () => {
    const buf = Buffer.from([0xff, 0xfe, 0x61, 0x62]);
    expect(detectEncodingFromSample(buf)).toBe('utf16le');
  });

  it('detects UTF-8 BOM', () => {
    const buf = Buffer.from([0xef, 0xbb, 0xbf, 0x61]);
    expect(detectEncodingFromSample(buf)).toBe('utf8');
  });

  it('prefers GB18030 when chardet favors a single-byte encoding over GB18030 by a small margin (ASCII + GBK)', () => {
    // Mixed "GBK" ASCII prefix + GBK Chinese; chardet often ranks ISO-8859-7 above GB18030 here.
    const buf = Buffer.from([
      0x47, 0x42, 0x4b, 0xb1, 0xe0, 0xc2, 0xeb, 0xb2, 0xe2, 0xca, 0xd4, 0x0a, 0xc4, 0xe3, 0xba, 0xc3,
      0xca, 0xc0, 0xbd, 0xe7, 0x0a
    ]);
    expect(detectEncodingFromSample(buf)).toBe('gb18030');
  });
});
