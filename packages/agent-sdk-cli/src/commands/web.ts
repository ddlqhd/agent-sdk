import { Command } from 'commander';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { parseProviderCli } from '../utils/agent-bootstrap.js';
import { describeCliLogLevelOption, parseCliLogLevel } from '../utils/sdk-log.js';
import { loadUserSettings } from '../utils/user-settings.js';
import type { ModelProvider } from '../web/shared/ws-protocol.js';
import { resolveWebClientDist } from '../web/paths.js';
import { parseListenPort, resolveListenPort } from '../web/http-utils.js';
import type { SDKLogLevel } from '@ddlqhd/agent-sdk';

export interface WebCommandOptions {
  port?: number;
  host?: string;
  demoTools?: boolean;
  allowRemote?: boolean;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  mcpConfig?: string;
  userBasePath?: string;
  cwd?: string;
  execServer?: string;
  execToken?: string;
  logLevel?: SDKLogLevel;
  logFile?: string;
}

/**
 * Local Agent Studio UI (HTTP + WebSocket `/ws`).
 */
export function createWebCommand(): Command {
  return new Command('web')
    .description('Start the local Agent Studio web UI (HTTP + WebSocket)')
    .option('--provider <provider>', 'LLM provider (openai/anthropic/ollama)', parseProviderCli)
    .option('-m, --model <model>', 'Model ID (written to UI defaults)')
    .option('-k, --api-key <key>', 'API key (server-side only)')
    .option('-u, --base-url <url>', 'API base URL for the selected --provider')
    .option('--mcp-config <path>', 'MCP config file (used when the UI path is empty)')
    .option('--user-base-path <path>', 'User base path (default: ~)')
    .option('--cwd <path>', 'Working directory (default: current directory)')
    .option('--exec-server <url>', 'Remote exec-server WebSocket URL')
    .option('--exec-token <token>', 'Shared token for the remote exec-server')
    .option('--log-level <level>', describeCliLogLevelOption(), parseCliLogLevel)
    .option('--log-file <path>', 'JSONL log file path')
    .option('--port <port>', 'Listen port (default: 3001, or PORT env)', parseListenPort)
    .option('--host <host>', 'Listen host (default: 127.0.0.1)')
    .option('--demo-tools', 'Register the DemoCalculator sample tool')
    .option(
      '--allow-remote',
      'Allow binding beyond loopback and skip WebSocket Origin checks (dangerous)'
    )
    .action(async (options: WebCommandOptions) => {
      try {
        const { startWebServer } = await import('../web/start-server.js');
        const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
        const userBasePath = options.userBasePath ? resolve(options.userBasePath) : homedir();
        const settings = loadUserSettings(userBasePath);
        const provider = options.provider
          ? parseProviderCli(options.provider)
          : (settings?.agentDefaultModel?.provider ?? 'openai');
        const port = resolveListenPort(options.port, process.env.PORT);
        const host = options.host ?? '127.0.0.1';

        await startWebServer({
          port,
          host,
          clientDist: resolveWebClientDist(),
          allowRemote: options.allowRemote === true,
          defaults: {
            cwd,
            userBasePath,
            mcpConfigPath: options.mcpConfig ?? settings?.agent?.mcpConfigPath,
            provider: provider as ModelProvider,
            model: options.model ?? settings?.agentDefaultModel?.model,
            apiKey: options.apiKey,
            baseUrl: options.baseUrl,
            includeDemoTools: options.demoTools === true,
            logLevel: options.logLevel,
            logFile: options.logFile,
            execServer: options.execServer,
            execToken: options.execToken,
            temperature: settings?.agentDefaultModel?.temperature,
            thinking: settings?.agentDefaultModel?.thinking,
            thinkingLevel: settings?.agentDefaultModel?.thinkingLevel,
            memory: settings?.agent?.memory,
            contextManagement: settings?.agent?.contextManagement,
            contextLength: settings?.agent?.contextLength,
            storage: settings?.web?.storage,
            safeToolsOnly: settings?.web?.safeToolsOnly
          }
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${msg}`));
        process.exit(1);
      }
    });
}
