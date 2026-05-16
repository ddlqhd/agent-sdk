import { describe, it, expect } from 'vitest';
import { formatMcpToolName, isMcpPrefixedToolName, validateMcpNameSegment } from '../../src/mcp/mcp-tool-name.js';

describe('formatMcpToolName', () => {
  it('builds mcp__server__tool', () => {
    expect(formatMcpToolName('filesystem', 'read_file')).toBe('mcp__filesystem__read_file');
  });

  it('supports empty tool segment for prefix checks', () => {
    expect(formatMcpToolName('myserver', '')).toBe('mcp__myserver__');
  });
});

describe('isMcpPrefixedToolName', () => {
  it('returns true for convention-shaped names', () => {
    expect(isMcpPrefixedToolName('mcp__fs__read')).toBe(true);
    expect(isMcpPrefixedToolName('mcp__a__b__c')).toBe(true);
  });

  it('returns false for legacy mcp_server__tool', () => {
    expect(isMcpPrefixedToolName('mcp_filesystem__read_file')).toBe(false);
  });

  it('returns false without a second segment', () => {
    expect(isMcpPrefixedToolName('mcp__only')).toBe(false);
    expect(isMcpPrefixedToolName('mcp__')).toBe(false);
  });

  it('returns false for unrelated names', () => {
    expect(isMcpPrefixedToolName('Read')).toBe(false);
    expect(isMcpPrefixedToolName('mcp_')).toBe(false);
  });
});

describe('validateMcpNameSegment', () => {
  it('accepts a normal serverName', () => {
    expect(validateMcpNameSegment('filesystem', 'serverName')).toBeNull();
  });

  it('accepts a normal toolName', () => {
    expect(validateMcpNameSegment('read_file', 'toolName')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateMcpNameSegment('', 'serverName')).toMatch(/must not be empty/);
  });

  it('rejects blank-only string', () => {
    expect(validateMcpNameSegment('   ', 'toolName')).toMatch(/must not be empty/);
  });

  it('rejects serverName containing __', () => {
    const err = validateMcpNameSegment('my__server', 'serverName');
    expect(err).not.toBeNull();
    expect(err).toMatch(/__/);
  });

  it('rejects toolName containing __', () => {
    const err = validateMcpNameSegment('do__thing', 'toolName');
    expect(err).not.toBeNull();
    expect(err).toMatch(/toolName/);
  });

  it('accepts names with single underscores', () => {
    expect(validateMcpNameSegment('my_server', 'serverName')).toBeNull();
    expect(validateMcpNameSegment('do_thing', 'toolName')).toBeNull();
  });
});
