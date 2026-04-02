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
});
