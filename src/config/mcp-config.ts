import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
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
      /** URL (HTTP transport) */
      url?: string;
      /** HTTP headers */
      headers?: Record<string, string>;
    };
  };
}

/**
 * MCP 配置加载结果
 */
export interface MCPConfigLoadResult {
  servers: MCPServerConfig[];
  configPath?: string;
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

    const server: MCPServerConfig = {
      name,
      transport,
      ...(transport === 'stdio'
        ? {
            command: serverConfig.command,
            args: serverConfig.args,
            env: serverConfig.env as Record<string, string>
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
 * 从当前目录向上搜索 mcp_config.json
 */
function findConfigFile(startDir: string = process.cwd()): string | null {
  let currentDir = startDir;

  // 最多向上搜索 10 层
  for (let i = 0; i < 10; i++) {
    const configPath = join(currentDir, 'mcp_config.json');
    if (existsSync(configPath)) {
      return configPath;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // 已到达根目录
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

/**
 * 加载 MCP 配置
 * @param configPath 可选的配置文件路径，如未提供则自动搜索
 * @param startDir 搜索起始目录，默认为当前工作目录
 */
export function loadMCPConfig(
  configPath?: string,
  startDir: string = process.cwd()
): MCPConfigLoadResult {
  // 确定配置文件路径
  const filePath = configPath || findConfigFile(startDir);

  if (!filePath) {
    return { servers: [] };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const rawConfig = JSON.parse(content) as MCPConfigFile;

    // 展开环境变量
    const expandedConfig = expandEnvVarsInObject(rawConfig) as MCPConfigFile;

    // 转换格式
    const servers = transformConfig(expandedConfig);

    return {
      servers,
      configPath: filePath
    };
  } catch (error) {
    console.error(`Failed to load MCP config from ${filePath}:`, error);
    return { servers: [] };
  }
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
  }

  return errors;
}