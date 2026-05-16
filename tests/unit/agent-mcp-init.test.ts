import { describe, it, expect, vi, afterEach } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

const noopModel: ModelAdapter = {
  name: 'noop',
  async *stream(_p: ModelParams): AsyncIterable<StreamChunk> {
    yield { type: 'done' };
  },
  async complete() {
    return { content: '' };
  }
};

describe('Agent MCP initialization reliability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('still attempts MCP init when skills initialization fails', async () => {
    vi.spyOn(SkillRegistry.prototype, 'initialize').mockRejectedValue(new Error('skills down'));

    const agent = new Agent({
      model: noopModel,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'memory' },
      mcpServers: [
        { name: 'bad', transport: 'stdio', command: 'nonexistent-mcp-binary-zzzz' }
      ]
    });

    const r = await agent.waitForInit();
    expect(r.skills.ok).toBe(false);
    expect(r.skills.error?.message).toContain('skills down');
    expect(r.mcp.enabled).toBe(true);
    expect(r.mcp.failed).toBe(1);
    expect(r.mcp.connected).toBe(0);
    expect(r.mcp.servers).toHaveLength(1);
    expect(r.mcp.servers[0].connected).toBe(false);
    expect(r.mcp.servers[0].errorMessage).toBeDefined();
  });

  it('waitForInit returns MCP server outcomes for failing stdio server', async () => {
    const agent = new Agent({
      model: noopModel,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'memory' },
      mcpServers: [{ name: 'x', transport: 'stdio', command: 'nonexistent-xxx-abc' }]
    });
    const r = await agent.waitForInit();
    expect(r.mcp.enabled).toBe(true);
    expect(r.mcp.connected).toBe(0);
    expect(r.mcp.failed).toBe(1);
    expect(r.hooks.ok).toBe(true);
  });
});
