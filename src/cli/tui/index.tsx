import { render } from 'ink';
import type { CLIConfig } from '../types.js';
import {
  addModelOptions,
  applyPreStreamFork,
  createCliAgent,
  destroyCliAgent,
  ensureChatSessionAttached,
  resolveCliSessionId
} from '../utils/agent-bootstrap.js';
import { TuiApp } from './app.js';

export async function runTui(options: CLIConfig): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('agent-sdk tui requires an interactive TTY. Use: agent-sdk chat');
    process.exit(1);
  }

  let sessionId = await resolveCliSessionId(options);
  const { agent, fileLogger, cwd } = await createCliAgent(options);

  sessionId = await applyPreStreamFork(agent, sessionId, options);
  if (sessionId) {
    await ensureChatSessionAttached(agent, sessionId);
  }

  const onExit = async () => {
    await destroyCliAgent(agent, fileLogger);
  };

  const { waitUntilExit } = render(
    <TuiApp
      agent={agent}
      options={options}
      cwd={cwd}
      initialSessionId={sessionId}
      onExit={onExit}
    />
  );

  await waitUntilExit();
  await onExit();
}

export { addModelOptions };
