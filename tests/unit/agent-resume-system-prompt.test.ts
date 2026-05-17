import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Agent } from '../../src/core/agent.js';
import type { ModelAdapter, ModelParams, StreamChunk } from '../../src/core/types.js';
import { SKILL_CONFIG_NO_AUTOLOAD } from '../helpers/agent-test-defaults.js';

function captureParamsModel(): { model: ModelAdapter; getLastParams: () => ModelParams | undefined } {
  let last: ModelParams | undefined;
  const model: ModelAdapter = {
    name: 'capture',
    async *stream(params: ModelParams): AsyncIterable<StreamChunk> {
      last = params;
      yield { type: 'text', content: 'ok' };
      yield { type: 'done' };
    },
    async complete() {
      return { content: 'ok' };
    }
  };
  return {
    model,
    getLastParams: () => last
  };
}

describe('Agent resume and system prompt', () => {
  it('applies options.systemPrompt on resume instead of keeping the first-run system text', async () => {
    const { model, getLastParams } = captureParamsModel();
    const userBase = await fs.mkdtemp(join(tmpdir(), 'resume-sys-'));

    const agent = new Agent({
      model,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'jsonl' },
      userBasePath: userBase,
      contextManagement: false
    });

    await agent.waitForInit();
    await agent.run('first', {
      systemPrompt: { content: 'PROMPT_A', mode: 'replace', includeEnvironment: false }
    });
    const sid = agent.getSessionManager().sessionId!;

    await agent.run('second', {
      sessionId: sid,
      systemPrompt: { content: 'PROMPT_B', mode: 'replace', includeEnvironment: false }
    });

    const params = getLastParams();
    expect(params).toBeDefined();
    const sysContent = params!.messages.find((m) => m.role === 'system')?.content;
    expect(typeof sysContent).toBe('string');
    expect(sysContent as string).toContain('PROMPT_B');
    expect(sysContent as string).not.toContain('PROMPT_A');

    await fs.rm(userBase, { recursive: true, force: true }).catch(() => {});
  });

  it('rebuilds environment section from current cwd when resuming with a new Agent instance', async () => {
    const { model, getLastParams } = captureParamsModel();
    const userBase = await fs.mkdtemp(join(tmpdir(), 'resume-cwd-'));
    const dirA = await fs.mkdtemp(join(tmpdir(), 'cwd-a-'));
    const dirB = await fs.mkdtemp(join(tmpdir(), 'cwd-b-'));

    const agentA = new Agent({
      model,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'jsonl' },
      userBasePath: userBase,
      cwd: dirA,
      contextManagement: false,
      systemPrompt: { content: '', mode: 'replace', includeEnvironment: true }
    });
    await agentA.waitForInit();
    await agentA.run('hi');
    const sid = agentA.getSessionManager().sessionId!;

    const agentB = new Agent({
      model,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'jsonl' },
      userBasePath: userBase,
      cwd: dirB,
      contextManagement: false,
      systemPrompt: { content: '', mode: 'replace', includeEnvironment: true }
    });
    await agentB.waitForInit();
    await agentB.run('again', { sessionId: sid });

    const params = getLastParams();
    const sysContent = params!.messages.find((m) => m.role === 'system')?.content as string;
    expect(sysContent).toContain(dirB);
    expect(sysContent).not.toContain(dirA);

    await fs.rm(userBase, { recursive: true, force: true }).catch(() => {});
  });

  it('first run still uses default_prompt source when no runtime systemPrompt is passed', async () => {
    const { model, getLastParams } = captureParamsModel();
    const onSystemMessage = vi.fn();

    const agent = new Agent({
      model,
      memory: false,
      skillConfig: SKILL_CONFIG_NO_AUTOLOAD,
      exclusiveTools: [],
      storage: { type: 'memory' },
      callbacks: { lifecycle: { onSystemMessage } },
      contextManagement: false
    });

    await agent.waitForInit();
    await agent.run('ping');

    expect(onSystemMessage).toHaveBeenCalled();
    expect(onSystemMessage.mock.calls.some((call) => call[1] === 'default_prompt')).toBe(true);
    const params = getLastParams();
    expect(params!.messages[0]?.role).toBe('system');
  });
});
