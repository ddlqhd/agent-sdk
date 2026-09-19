import { join } from 'node:path';
import {
  type Agent,
  type AgentLifecycleCallbacks,
  type AskUserQuestionResolver,
  type MCPServerConfig
} from '@ddlqhd/agent-sdk';
import { buildControlAgent, resolveRemoteEnvironmentConfig } from '@ddlqhd/agent-sdk-control';
import type { EventBridge } from './event-bridge.js';
import { extractTodosFromToolResult } from './event-bridge.js';
import { AUTO_APPROVED_TOOLS, createCanUseTool, type PermissionContext } from './permissions.js';
import {
  describeMissingKey,
  requireProviderKey,
  resolveModel,
  resolveProvider,
  type ModelProvider
} from './env.js';
import { resolveModelBaseUrl } from '@ddlqhd/agent-sdk-control';
import { logInfo } from './logging.js';
import { ensureSdkBuilt } from './paths.js';
import { resolveAcpUserBase } from './user-base.js';

export interface BuildSessionAgentOptions {
  cwd: string;
  sessionId: string;
  permissionCtx: PermissionContext;
  eventBridge: EventBridge;
  askUserQuestion?: AskUserQuestionResolver;
  provider?: ModelProvider;
  model?: string;
  userBasePath?: string;
  mcpServers?: MCPServerConfig[];
}

export async function buildSessionAgent(options: BuildSessionAgentOptions): Promise<Agent> {
  ensureSdkBuilt();

  const provider = options.provider ?? resolveProvider();
  const modelId = options.model ?? resolveModel(provider);
  const apiKey = requireProviderKey(provider);
  if (provider !== 'ollama' && !apiKey) {
    throw new Error(describeMissingKey(provider));
  }

  const userBasePath = options.userBasePath?.trim() || resolveAcpUserBase();

  const lifecycle: AgentLifecycleCallbacks = {
    onToolResult: async (ctx) => {
      if (ctx.toolName !== 'TodoWrite') return;
      const todos = extractTodosFromToolResult(ctx.result.metadata);
      if (todos) {
        await options.eventBridge.emitPlanFromTodos(todos);
      }
    },
    onSessionFork: (ctx) => {
      logInfo(
        'session fork',
        `${ctx.sourceSessionId} -> ${ctx.sessionId} (${ctx.messageCount} messages)`
      );
    }
  };

  return buildControlAgent({
    modelConfig: {
      provider,
      apiKey,
      baseUrl: resolveModelBaseUrl(provider),
      model: modelId
    },
    cwd: options.cwd,
    userBasePath,
    storage: { type: 'jsonl' },
    memory: true,
    contextManagement: true,
    skillConfig: {
      autoLoad: true,
      workspacePath: join(options.cwd, '.claude', 'skills')
    },
    includeEnvironment: true,
    environment: resolveRemoteEnvironmentConfig(),
    allowedTools: [...AUTO_APPROVED_TOOLS],
    disallowedTools: ['AskUserQuestion'],
    canUseTool: createCanUseTool(options.permissionCtx),
    askUserQuestion: options.askUserQuestion,
    callbacks: { lifecycle },
    mcpServers: options.mcpServers,
    loadMCPConfigFromFiles: true,
    logLevel: process.env.AGENT_SDK_LOG_LEVEL === 'debug' ? 'debug' : 'warn'
  });
}
