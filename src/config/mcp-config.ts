import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { MCPServerConfig, SDKLogSink } from '../core/types.js';
import { emitSDKLog } from '../core/logger.js';

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
      /**
       * MCP 建连超时（毫秒），见 {@link MCPServerConfig.connectTimeoutMs}
       */
      connectTimeoutMs?: number;
    };
  };
}

/**
 * MCP 配置加载错误（非致命；`loadMCPConfig` 不抛错）
 */
export type MCPConfigLoadErrorKind =
  | 'path_not_found'
  | 'parse_error'
  | 'validation_error'
  | 'missing_env_var';

export interface MCPConfigLoadError {
  kind: MCPConfigLoadErrorKind;
  /** 相关配置文件路径（若有） */
  path: string;
  message: string;
  /** `validation_error` 且为单条 server 失败时，对应 `mcpServers` 的 key */
  serverName?: string;
  /** `validation_error` 时来自校验的明细 */
  validationMessages?: string[];
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
  /** 非致命问题（路径不存在、解析/校验失败等） */
  errors?: MCPConfigLoadError[];
}

/**
 * 展开单个字符串中的环境变量，同时将未定义的变量名收集到 `missing` 集合中。
 * 保留原有行为：未定义的变量展开为空字符串。
 */
function expandEnvVars(value: string, missing: Set<string>): string {
  let result = value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    if (!(varName in process.env)) {
      missing.add(varName as string);
    }
    return process.env[varName as string] ?? '';
  });

  result = result.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, varName) => {
    if (!(varName in process.env)) {
      missing.add(varName as string);
    }
    return process.env[varName as string] ?? '';
  });

  return result;
}

/**
 * 递归展开对象中的环境变量，将未定义的变量名收集到 `missing` 集合中。
 */
function expandEnvVarsInObject(obj: unknown, missing: Set<string>): unknown {
  if (typeof obj === 'string') {
    return expandEnvVars(obj, missing);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => expandEnvVarsInObject(item, missing));
  }

  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = expandEnvVarsInObject(value, missing);
    }
    return result;
  }

  return obj;
}

/**
 * 校验 `mcpServers` 中的单条 server 配置（与 {@link validateMCPConfig} 规则一致）
 */
export function validateMCPServerEntry(
  name: string,
  server: MCPConfigFile['mcpServers'][string]
): string[] {
  const errors: string[] = [];
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
  if (server.connectTimeoutMs !== undefined) {
    if (
      typeof server.connectTimeoutMs !== 'number' ||
      !Number.isFinite(server.connectTimeoutMs) ||
      server.connectTimeoutMs < 0
    ) {
      errors.push(`Server "${name}": "connectTimeoutMs" must be a non-negative finite number`);
    }
  }
  return errors;
}

/**
 * 将单条 Claude Desktop server 条目转为 {@link MCPServerConfig}
 */
function transformServerEntry(
  name: string,
  serverConfig: MCPConfigFile['mcpServers'][string]
): MCPServerConfig {
  const transport = serverConfig.url ? 'http' : 'stdio';

  const toolTimeoutMs =
    typeof serverConfig.toolTimeoutMs === 'number' &&
    Number.isFinite(serverConfig.toolTimeoutMs) &&
    serverConfig.toolTimeoutMs > 0
      ? serverConfig.toolTimeoutMs
      : undefined;
  const connectTimeoutMs =
    typeof serverConfig.connectTimeoutMs === 'number' &&
    Number.isFinite(serverConfig.connectTimeoutMs) &&
    serverConfig.connectTimeoutMs > 0
      ? serverConfig.connectTimeoutMs
      : undefined;

  return {
    name,
    transport,
    ...(toolTimeoutMs !== undefined ? { toolTimeoutMs } : {}),
    ...(connectTimeoutMs !== undefined ? { connectTimeoutMs } : {}),
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
 * 解析、校验并转换单个配置文件
 */
function tryLoadConfigFile(
  filePath: string,
  startDir: string,
  sdkLog?: SDKLogSink
): { servers: MCPServerConfig[]; errors: MCPConfigLoadError[] } {
  const errors: MCPConfigLoadError[] = [];
  try {
    const content = readFileSync(filePath, 'utf-8');
    const rawConfig = JSON.parse(content) as unknown;
    const missingEnvVars = new Set<string>();
    const expandedConfig = expandEnvVarsInObject(rawConfig, missingEnvVars) as MCPConfigFile;

    if (missingEnvVars.size > 0) {
      const varList = Array.from(missingEnvVars).sort();
      const err: MCPConfigLoadError = {
        kind: 'missing_env_var',
        path: filePath,
        message: `MCP config references undefined environment variable(s): ${varList.join(', ')} (expanded to empty string)`,
        validationMessages: varList
      };
      errors.push(err);
      if (sdkLog) {
        emitSDKLog({
          logger: sdkLog.logger,
          logLevel: sdkLog.logLevel,
          redaction: sdkLog.redaction,
          level: 'warn',
          event: {
            component: 'mcp',
            event: 'mcp.config.env.missing',
            message: err.message,
            cwd: startDir,
            errorName: 'MissingEnvVar',
            errorMessage: err.message,
            metadata: { path: filePath, kind: 'missing_env_var', variables: varList }
          }
        });
      }
    }

    if (!expandedConfig.mcpServers || typeof expandedConfig.mcpServers !== 'object') {
      const msgs = ['mcpServers must be an object'];
      const err: MCPConfigLoadError = {
        kind: 'validation_error',
        path: filePath,
        message: `MCP config validation failed: ${filePath}`,
        validationMessages: msgs
      };
      errors.push(err);
      if (sdkLog) {
        emitSDKLog({
          logger: sdkLog.logger,
          logLevel: sdkLog.logLevel,
          redaction: sdkLog.redaction,
          level: 'error',
          event: {
            component: 'mcp',
            event: 'mcp.config.load.error',
            message: err.message,
            cwd: startDir,
            errorName: 'ValidationError',
            errorMessage: msgs.join('; '),
            metadata: {
              path: filePath,
              kind: 'validation_error',
              validationMessages: msgs
            }
          }
        });
      }
      return { servers: [], errors };
    }

    const servers: MCPServerConfig[] = [];
    for (const [name, serverConfig] of Object.entries(expandedConfig.mcpServers)) {
      const entryErrors = validateMCPServerEntry(name, serverConfig);
      if (entryErrors.length > 0) {
        const err: MCPConfigLoadError = {
          kind: 'validation_error',
          path: filePath,
          serverName: name,
          message: `MCP server "${name}" invalid in ${filePath}`,
          validationMessages: entryErrors
        };
        errors.push(err);
        if (sdkLog) {
          emitSDKLog({
            logger: sdkLog.logger,
            logLevel: sdkLog.logLevel,
            redaction: sdkLog.redaction,
            level: 'error',
            event: {
              component: 'mcp',
              event: 'mcp.config.load.error',
              message: err.message,
              cwd: startDir,
              errorName: 'ValidationError',
              errorMessage: entryErrors.join('; '),
              metadata: {
                path: filePath,
                kind: 'validation_error',
                serverName: name,
                validationMessages: entryErrors
              }
            }
          });
        }
        continue;
      }
      servers.push(transformServerEntry(name, serverConfig));
    }
    return { servers, errors };
  } catch (error) {
    const caught = error instanceof Error ? error : new Error(String(error));
    const err: MCPConfigLoadError = {
      kind: 'parse_error',
      path: filePath,
      message: caught.message
    };
    errors.push(err);
    if (sdkLog) {
      emitSDKLog({
        logger: sdkLog.logger,
        logLevel: sdkLog.logLevel,
        redaction: sdkLog.redaction,
        level: 'error',
        event: {
          component: 'mcp',
          event: 'mcp.config.load.error',
          message: 'Failed to load MCP JSON config',
          cwd: startDir,
          errorName: caught.name,
          errorMessage: caught.message,
          metadata: { path: filePath, kind: 'parse_error' }
        }
      });
    }
    return { servers: [], errors };
  }
}

/**
 * 加载 MCP 配置
 * @param configPath 可选的配置文件路径，如未提供则自动加载用户目录和工作目录配置
 * @param startDir 搜索起始目录，默认为当前工作目录
 * @param userBasePath 用户级基础路径，默认 ~ (homedir)
 * @param sdkLog 可选宿主日志；未传时只返回 `errors`，由调用方决定如何展示
 */
export function loadMCPConfig(
  configPath?: string,
  startDir: string = process.cwd(),
  userBasePath?: string,
  sdkLog?: SDKLogSink
): MCPConfigLoadResult {
  // 显式指定路径 -> 单文件加载
  if (configPath) {
    if (!existsSync(configPath)) {
      const err: MCPConfigLoadError = {
        kind: 'path_not_found',
        path: configPath,
        message: `MCP config file not found: ${configPath}`
      };
      if (sdkLog) {
        emitSDKLog({
          logger: sdkLog.logger,
          logLevel: sdkLog.logLevel,
          redaction: sdkLog.redaction,
          level: 'error',
          event: {
            component: 'mcp',
            event: 'mcp.config.load.error',
            message: err.message,
            cwd: startDir,
            errorName: 'NotFoundError',
            errorMessage: err.message,
            metadata: { path: configPath, kind: 'path_not_found' }
          }
        });
      }
      return { servers: [], configPath, errors: [err] };
    }

    const { servers, errors } = tryLoadConfigFile(configPath, startDir, sdkLog);
    return {
      servers,
      configPath,
      errors: errors.length ? errors : undefined
    };
  }

  // 自动加载 -> 多文件合并
  const configPaths = findConfigFiles(startDir, userBasePath);
  if (configPaths.length === 0) {
    return { servers: [] };
  }

  const mergedServers = new Map<string, MCPServerConfig>();
  const aggregatedErrors: MCPConfigLoadError[] = [];
  for (const path of configPaths) {
    const { servers, errors } = tryLoadConfigFile(path, startDir, sdkLog);
    aggregatedErrors.push(...errors);
    for (const server of servers) {
      mergedServers.set(server.name, server);
    }
  }

  return {
    servers: Array.from(mergedServers.values()),
    configPath: configPaths[configPaths.length - 1], // 主配置（工作目录）
    configPaths,
    errors: aggregatedErrors.length ? aggregatedErrors : undefined
  };
}

/**
 * 验证 MCP 配置
 */
export function validateMCPConfig(config: MCPConfigFile): string[] {
  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    return ['mcpServers must be an object'];
  }
  const errors: string[] = [];
  for (const [name, server] of Object.entries(config.mcpServers)) {
    errors.push(...validateMCPServerEntry(name, server));
  }
  return errors;
}