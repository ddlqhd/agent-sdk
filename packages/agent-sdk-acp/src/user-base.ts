import { resolveAcpUserBase } from '@ddlqhd/agent-sdk-control';

/**
 * Stable user-level base path for session/skill/memory storage.
 * Without AGENT_SDK_ACP_USER_BASE, all sessions share tmpdir()/agent-sdk-acp.
 */
export { resolveAcpUserBase };
