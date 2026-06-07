import { join } from 'node:path';
import {
  Agent,
  createModel,
  type AgentLifecycleCallbacks,
  type AskUserQuestionResolver,
  type MCPServerConfig
} from '@ddlqhd/agent-sdk';
import type { EventBridge } from './event-bridge.js';
import { extractTodosFromToolResult } from './event-bridge.js';
import { AUTO_APPROVED_TOOLS, createCanUseTool, type PermissionContext } from './permissions.js';
import {
  describeMissingKey,
  getOllamaBaseUrl,
  requireProviderKey,
  resolveModel,
  resolveProvider,
  type ModelProvider
} from './env.js';
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
    }
  };

  const agent = new Agent({
    model: createModel({
      provider,
      apiKey,
      baseUrl: provider === 'ollama' ? getOllamaBaseUrl() : undefined,
      model: modelId
    }),
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
    allowedTools: [...AUTO_APPROVED_TOOLS],
    disallowedTools: ['AskUserQuestion'],
    canUseTool: createCanUseTool(options.permissionCtx),
    askUserQuestion: options.askUserQuestion,
    callbacks: { lifecycle },
    mcpServers: options.mcpServers,
    loadMCPConfigFromFiles: true,
    logLevel: process.env.AGENT_SDK_LOG_LEVEL === 'debug' ? 'debug' : 'warn'
  });

  await agent.waitForInit();
  return agent;
}
