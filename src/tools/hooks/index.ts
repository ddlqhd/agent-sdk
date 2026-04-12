export type {
  CommandHookConfig,
  FunctionHook,
  HookCommandStdin,
  HookContext,
  HookEventType,
  HookGroupConfig,
  HookResult,
  HooksSettings,
  HooksSettingsFile
} from './types.js';

export { parseHooksSettingsFile, loadHooksSettingsFromProject, loadHooksSettingsFromUser } from './loader.js';

export { matchTool, matchesHookIfClause } from './hook-if.js';
export { parsePreToolUseCommandOutput } from './parse-output.js';

export { HookManager, createFunctionHook, buildHookEnv, mergeCommandHookLayers } from './manager.js';

export type { FlatCommandHookEntry } from './manager.js';
