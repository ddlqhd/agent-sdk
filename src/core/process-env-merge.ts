/**
 * 当前 `process.env` 中值为 string 的键的快照，再叠 `overrides`（后者覆盖同名键）。
 * 供应用层构造 model（如显式传入 `apiKey`）与 Agent 内部合并 MCP stdio 环境共用。
 *
 * 注意：快照包含当前进程 environ 中的敏感变量；传入 MCP 子进程时由调用方控制 `env` / `overrides`。
 */
export function mergeProcessEnv(overrides?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      base[key] = value;
    }
  }
  return overrides ? { ...base, ...overrides } : base;
}

/**
 * stdio MCP 子进程环境：`process.env` + 可选 Agent 级 `env` + 可选单服务 `MCPServerConfig.env`（优先级递增）。
 */
export function mergeMcpStdioEnv(
  agentEnv?: Record<string, string>,
  serverEnv?: Record<string, string>
): Record<string, string> {
  const merged = mergeProcessEnv(agentEnv);
  return serverEnv ? { ...merged, ...serverEnv } : merged;
}
