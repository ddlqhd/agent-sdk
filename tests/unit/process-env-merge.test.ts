import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mergeProcessEnv, mergeMcpStdioEnv } from '../../src/core/process-env-merge.js';

const KEY_AGENT = 'AGENT_SDK_MERGE_TEST_AGENT';
const KEY_SERVER = 'AGENT_SDK_MERGE_TEST_SERVER';
const KEY_BASE = 'AGENT_SDK_MERGE_TEST_BASE';

describe('mergeProcessEnv', () => {
  afterEach(() => {
    delete process.env[KEY_AGENT];
    delete process.env[KEY_SERVER];
    delete process.env[KEY_BASE];
  });

  it('includes string entries from process.env', () => {
    process.env[KEY_BASE] = 'from_process';
    const merged = mergeProcessEnv();
    expect(merged[KEY_BASE]).toBe('from_process');
  });

  it('applies overrides on top of process.env', () => {
    process.env[KEY_BASE] = 'from_process';
    const merged = mergeProcessEnv({ [KEY_BASE]: 'from_override', [KEY_AGENT]: 'only_override' });
    expect(merged[KEY_BASE]).toBe('from_override');
    expect(merged[KEY_AGENT]).toBe('only_override');
  });

  it('returns only process snapshot when overrides undefined', () => {
    process.env[KEY_BASE] = 'x';
    const merged = mergeProcessEnv(undefined);
    expect(merged[KEY_BASE]).toBe('x');
  });
});

describe('mergeMcpStdioEnv', () => {
  beforeEach(() => {
    process.env[KEY_BASE] = 'base';
  });

  afterEach(() => {
    delete process.env[KEY_AGENT];
    delete process.env[KEY_SERVER];
    delete process.env[KEY_BASE];
  });

  it('layers agent then server over process.env', () => {
    process.env[KEY_AGENT] = 'should_be_replaced_by_agent_config';
    const merged = mergeMcpStdioEnv(
      { [KEY_AGENT]: 'from_agent', [KEY_SERVER]: 'from_agent_server_key' },
      { [KEY_SERVER]: 'from_server' }
    );
    expect(merged[KEY_BASE]).toBe('base');
    expect(merged[KEY_AGENT]).toBe('from_agent');
    expect(merged[KEY_SERVER]).toBe('from_server');
  });

  it('matches mergeProcessEnv(agent) when server env omitted', () => {
    const agent = { [KEY_AGENT]: 'a' };
    expect(mergeMcpStdioEnv(agent, undefined)).toEqual(mergeProcessEnv(agent));
  });
});
