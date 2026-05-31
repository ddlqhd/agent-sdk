import type { SDKLogContext } from '../../core/types.js';

/**
 * Hook 管线写入结构化日志时可用的宿主上下文（由 Agent 周期性更新）。
 * @deprecated Use {@link SDKLogContext} from `../../core/types.js`.
 */
export type HookManagerSdkLogContext = SDKLogContext;
