import { describe, it, expect, vi, afterEach } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import type { MCPServerConfig, ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
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

describe('Agent MCP parallel initialization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const baseOpts = (): ConstructorParameters<typeof Agent>[0] => ({
    model: noopModel,
    memory: false,
    skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
    exclusiveTools: [],
    storage: { type: 'memory' as const },
    loadHookSettingsFromFiles: false,
    contextManagement: false,
    subagent: { enabled: false }
  });

  it('starts all MCP connects in parallel (single timer slice for stacked delays)', async () => {
    vi.useFakeTimers();
    vi.spyOn(Agent.prototype, 'connectMCP').mockImplementation(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 50));
      return 0;
    });

    const agent = new Agent({
      ...baseOpts(),
      mcpServers: [
        { name: 'one', transport: 'stdio', command: 'noop', args: [] },
        { name: 'two', transport: 'stdio', command: 'noop', args: [] }
      ]
    });

    const done = agent.waitForInit();
    await vi.advanceTimersByTimeAsync(50);
    const r = await done;

    expect(r.mcp.connected).toBe(2);
    expect(r.mcp.failed).toBe(0);
  });

  it('keeps waitForInit mcp.servers order matching mcpServers config', async () => {
    vi.spyOn(Agent.prototype, 'connectMCP').mockImplementation(async (cfg: MCPServerConfig) => {
      await new Promise<void>(resolve =>
        setTimeout(resolve, cfg.name === 'b' ? 5 : cfg.name === 'a' ? 20 : 1)
      );
      return 0;
    });

    const agent = new Agent({
      ...baseOpts(),
      mcpServers: [
        { name: 'a', transport: 'stdio', command: 'noop', args: [] },
        { name: 'b', transport: 'stdio', command: 'noop', args: [] },
        { name: 'c', transport: 'stdio', command: 'noop', args: [] }
      ]
    });

    const r = await agent.waitForInit();

    expect(r.mcp.servers.map(s => s.name)).toEqual(['a', 'b', 'c']);
    expect(r.mcp.connected).toBe(3);
  });

  it('reports parallel mixed success and failure without blocking successes', async () => {
    vi.spyOn(Agent.prototype, 'connectMCP').mockImplementation(async (cfg: MCPServerConfig) => {
      if (cfg.name === 'bad') {
        throw new Error('planned failure');
      }
      return 0;
    });

    const agent = new Agent({
      ...baseOpts(),
      mcpServers: [
        { name: 'bad', transport: 'stdio', command: 'noop', args: [] },
        { name: 'ok', transport: 'stdio', command: 'noop', args: [] }
      ]
    });

    const r = await agent.waitForInit();

    expect(r.mcp.connected).toBe(1);
    expect(r.mcp.failed).toBe(1);
    expect(r.mcp.servers[0]).toMatchObject({ name: 'bad', connected: false });
    expect(r.mcp.servers[0].errorMessage).toContain('planned failure');
    expect(r.mcp.servers[1]).toMatchObject({ name: 'ok', connected: true });
  });

  it('does not connect duplicate server names beyond the first occurrence', async () => {
    const spy = vi.spyOn(Agent.prototype, 'connectMCP').mockResolvedValue(3);

    const agent = new Agent({
      ...baseOpts(),
      mcpServers: [
        { name: 'dup', transport: 'stdio', command: 'echo', args: [] },
        { name: 'dup', transport: 'stdio', command: 'echo', args: [] },
        { name: 'solo', transport: 'stdio', command: 'echo', args: [] }
      ]
    });

    const r = await agent.waitForInit();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(r.mcp.connected).toBe(2);
    expect(r.mcp.failed).toBe(0);
    expect(r.mcp.skippedDuplicates).toBe(1);
    expect(r.mcp.servers[1]).toMatchObject({
      connected: false,
      errorName: 'DuplicateMcpServerName'
    });
    expect(r.mcp.servers[1].errorMessage ?? '').toContain('duplicate name');
    expect(r.mcp.servers.map(s => s.name)).toEqual(['dup', 'dup', 'solo']);
  });
});
