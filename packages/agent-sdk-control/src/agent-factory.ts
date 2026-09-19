import {
  Agent,
  assertAgentEnvironmentReady,
  type AgentConfig
} from '@ddlqhd/agent-sdk';
import { resolveRemoteEnvironmentConfig } from './remote-environment.js';

export type ControlAgentConfig = AgentConfig & {
  afterInit?: (agent: Agent) => void | Promise<void>;
};

/**
 * Construct an {@link Agent}, wait for init, and fail closed if the execution plane is not ready.
 * Hosts (CLI / Web / ACP) should go through this instead of `new Agent` + `waitForInit`.
 */
export async function buildControlAgent(config: ControlAgentConfig): Promise<Agent> {
  const { afterInit, environment, ...rest } = config;
  const agent = new Agent({
    ...rest,
    environment: environment ?? resolveRemoteEnvironmentConfig()
  });

  const initResult = await agent.waitForInit();
  try {
    assertAgentEnvironmentReady(initResult);
    await afterInit?.(agent);
  } catch (error) {
    await agent.destroy();
    throw error;
  }
  return agent;
}
