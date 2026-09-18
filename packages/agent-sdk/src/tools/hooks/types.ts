import type { ToolResult } from '../../core/types.js';

/**
 * Hook 事件类型（运行时）
 */
export type HookEventType = 'preToolUse' | 'postToolUse' | 'postToolUseFailure';

/**
 * Hook 执行上下文
 */
export interface HookContext {
  eventType: HookEventType;
  toolName: string;
  /** 已校验的工具参数 */
  toolInput: Record<string, unknown>;
  toolCallId?: string;
  timestamp: number;
  projectDir?: string;

  /** PostToolUse：handler 返回的原始结果（未经 outputHandler） */
  toolResultRaw?: ToolResult;
  /** PostToolUse：将返回给调用方的最终结果 */
  toolResultFinal?: ToolResult;

  /** PostToolUseFailure */
  errorMessage?: string;
  failureKind?: 'validation' | 'handler_throw' | 'tool_error';
}

/**
 * PreToolUse 阶段 Hook 执行结果
 */
export interface HookResult {
  allowed: boolean;
  reason?: string;
  updatedInput?: Record<string, unknown>;
}

/**
 * JavaScript 函数 Hook（代码设置方式）
 */
export interface FunctionHook {
  id: string;
  event: HookEventType;
  matcher?: string;
  handler: (context: HookContext) => Promise<HookResult | void>;
  description?: string;
}

/**
 * Shell 命令 Hook 配置（配置文件解析后）
 */
export interface CommandHookConfig {
  id?: string;
  type: 'command';
  command: string;
  /** `ToolName(glob)`，与 Claude Code 一致；仅当匹配时对本次调用运行该 hook */
  if?: string;
  timeout?: number;
  async?: boolean;
}

export interface HookGroupConfig {
  matcher?: string;
  hooks: CommandHookConfig[];
}

/**
 * 配置文件解析后的设置（内部）
 */
export interface HooksSettings {
  disableAllHooks?: boolean;
  hooks: Record<HookEventType, HookGroupConfig[]>;
}

/** 磁盘 JSON（hooks 下为 PascalCase 键） */
export interface HooksSettingsFile {
  disableAllHooks?: boolean;
  hooks?: {
    PreToolUse?: HookGroupConfig[];
    PostToolUse?: HookGroupConfig[];
    PostToolUseFailure?: HookGroupConfig[];
  };
}

/**
 * stdin JSON（命令 Hook）
 */
export interface HookCommandStdin {
  hook_event: HookEventType;
  tool_name: string;
  tool_call_id?: string;
  project_dir?: string;
  tool_input: Record<string, unknown>;
  tool_result_raw?: { content: string; isError?: boolean };
  tool_result_final?: { content: string; isError?: boolean };
  error_message?: string;
  failure_kind?: 'validation' | 'handler_throw' | 'tool_error';
}
