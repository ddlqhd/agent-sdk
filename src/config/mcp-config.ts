import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { MCPServerConfig } from '../core/types.js';

/**
 * MCP 配置文件格式 (Claude Desktop 兼容)
 */
export interface MCPConfigFile {
  mcpServers: {
    [name: string]: {
      /** 命令 (stdio transport) */
      command?: string;
      /** 命令参数 */
      args?: string[];
      /** 环境变量 */
      env?: Record<string, string>;
      /** stdio 子进程工作目录 */
      cwd?: string;
      /** URL (HTTP transport) */
      url?: string;
      /** HTTP headers */
      headers?: Record<string, string>;
      /**
       * 单次 MCP 工具调用超时（毫秒），见 {@link MCPServerConfig.toolTimeoutMs}
       */
      toolTimeoutMs?: number;
    };
  };
}

/**
 * MCP 配置加载结果
 */
export interface MCPConfigLoadResult {
  servers: MCPServerConfig[];
  /** 主配置文件路径 */
  configPath?: string;
  /** 所有加载的配置文件路径 */
  configPaths?: string[];
}

/**
 * 展开环境变量
 * 支持 ${VAR} 和 $VAR 格式
 */
function expandEnvVars(value: string): string {
  // 匹配 ${VAR} 格式
  let result = value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || '';
  });

  // 匹配 $VAR 格式
  result = result.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, varName) => {
    return process.env[varName] || '';
  });

  return result;
}

/**
 * 递归展开对象中的环境变量
 */
function expandEnvVarsInObject(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return expandEnvVars(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => expandEnvVarsInObject(item));
  }

  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = expandEnvVarsInObject(value);
    }
    return result;
  }

  return obj;
}

/**
 * 将 Claude Desktop 格式转换为内部 MCPServerConfig[]
 */
function transformConfig(config: MCPConfigFile): MCPServerConfig[] {
  const servers: MCPServerConfig[] = [];

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    // 根据是否有 url 判断 transport 类型
    const transport = serverConfig.url ? 'http' : 'stdio';

    const toolTimeoutMs =
      typeof serverConfig.toolTimeoutMs === 'number' &&
      Number.isFinite(serverConfig.toolTimeoutMs) &&
      serverConfig.toolTimeoutMs > 0
        ? serverConfig.toolTimeoutMs
        : undefined;

    const server: MCPServerConfig = {
      name,
      transport,
      ...(toolTimeoutMs !== undefined ? { toolTimeoutMs } : {}),
      ...(transport === 'stdio'
        ? {
            command: serverConfig.command,
            args: serverConfig.args,
            env: serverConfig.env as Record<string, string>,
            cwd: serverConfig.cwd
          }
        : {
            url: serverConfig.url,
            headers: serverConfig.headers
          })
    };

    servers.push(server);
  }

  return servers;
}

/**
 * 查找配置文件
 * 支持用户目录和工作目录两种路径
 */
function findConfigFiles(startDir: string = process.cwd(), userBasePath?: string): string[] {
  const paths: string[] = [];
  const base = userBasePath || homedir();

  // 用户目录（优先级低，先加载）
  const userConfig = join(base, '.claude', 'mcp_config.json');
  if (existsSync(userConfig)) {
    paths.push(userConfig);
  }

  // 工作目录（优先级高，后加载覆盖）
  const workspaceConfig = join(startDir, '.claude', 'mcp_config.json');
  if (existsSync(workspaceConfig)) {
    paths.push(workspaceConfig);
  }

  return paths;
}

/**
 * 加载单个配置文件
 */
function loadSingleConfig(filePath: string): MCPServerConfig[] {
  const content = readFileSync(filePath, 'utf-8');
  const rawConfig = JSON.parse(content) as MCPConfigFile;
  const expandedConfig = expandEnvVarsInObject(rawConfig) as MCPConfigFile;
  return transformConfig(expandedConfig);
}

/**
 * 加载 MCP 配置
 * @param configPath 可选的配置文件路径，如未提供则自动加载用户目录和工作目录配置
 * @param startDir 搜索起始目录，默认为当前工作目录
 * @param userBasePath 用户级基础路径，默认 ~ (homedir)
 */
export function loadMCPConfig(
  configPath?: string,
  startDir: string = process.cwd(),
  userBasePath?: string
): MCPConfigLoadResult {
  // 显式指定路径 -> 单文件加载
  if (configPath) {
    if (!existsSync(configPath)) {
      return { servers: [] };
    }

    try {
      const servers = loadSingleConfig(configPath);
      return { servers, configPath };
    } catch (error) {
      console.error(`Failed to load MCP config from ${configPath}:`, error);
      return { servers: [] };
    }
  }

  // 自动加载 -> 多文件合并
  const configPaths = findConfigFiles(startDir, userBasePath);
  if (configPaths.length === 0) {
    return { servers: [] };
  }

  // 合并配置（用户目录先加载，工作目录后覆盖）
  const mergedServers = new Map<string, MCPServerConfig>();
  for (const path of configPaths) {
    try {
      const servers = loadSingleConfig(path);
      for (const server of servers) {
        mergedServers.set(server.name, server);
      }
    } catch (error) {
      console.error(`Failed to load MCP config from ${path}:`, error);
    }
  }

  return {
    servers: Array.from(mergedServers.values()),
    configPath: configPaths[configPaths.length - 1], // 主配置（工作目录）
    configPaths
  };
}

/**
 * 验证 MCP 配置
 */
export function validateMCPConfig(config: MCPConfigFile): string[] {
  const errors: string[] = [];

  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    errors.push('mcpServers must be an object');
    return errors;
  }

  for (const [name, server] of Object.entries(config.mcpServers)) {
    if (!server.command && !server.url) {
      errors.push(`Server "${name}": must have either "command" or "url"`);
    }

    if (server.command && server.url) {
      errors.push(`Server "${name}": cannot have both "command" and "url"`);
    }

    if (server.toolTimeoutMs !== undefined) {
      if (
        typeof server.toolTimeoutMs !== 'number' ||
        !Number.isFinite(server.toolTimeoutMs) ||
        server.toolTimeoutMs < 0
      ) {
        errors.push(`Server "${name}": "toolTimeoutMs" must be a non-negative finite number`);
      }
    }
  }

  return errors;
}