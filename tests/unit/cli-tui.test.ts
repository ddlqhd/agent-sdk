import { describe, it, expect, vi } from 'vitest';
import { openCheckpointsModal } from '../../packages/agent-sdk-cli/src/tui/app.js';
import type { Agent } from '../../packages/agent-sdk/src/core/agent.js';

describe('openCheckpointsModal', () => {
  it('lists checkpoints after attach', async () => {
    const checkpoints = [{ checkpointId: 'c1', userTurnIndex: 0, preview: 'hi' }];
    const agent = {
      getSessionManager: () => ({
        sessionId: 's1',
        attachSession: vi.fn(async () => {})
      }),
      listSessionCheckpoints: vi.fn(async () => checkpoints)
    } as unknown as Agent;

    const result = await openCheckpointsModal(agent, 's1');
    expect(result).toEqual(checkpoints);
  });
});
