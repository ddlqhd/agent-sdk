import chalk from 'chalk';
import type { CLIConfig } from '../types.js';
import { createStreamFormatter, formatUsage } from '../utils/output.js';
import {
  applyPreStreamFork,
  buildStreamOptions,
  createCliAgent,
  destroyCliAgent,
  resolveCliSessionId
} from '../utils/agent-bootstrap.js';
import { isHeadlessCli } from '../utils/print-prompt.js';

/**
 * Run a single non-interactive prompt (headless `-p` mode).
 */
export async function executeSinglePrompt(prompt: string, options: CLIConfig): Promise<void> {
  const headless = isHeadlessCli(options);

  try {
    let sessionId = await resolveCliSessionId(options);
    const { agent, fileLogger } = await createCliAgent(options);
    sessionId = await applyPreStreamFork(agent, sessionId, options, { headless });

    try {
      if (options.output === 'json') {
        const result = await agent.run(prompt, buildStreamOptions(sessionId));
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else if (options.stream !== false) {
        const formatter = createStreamFormatter({ verbose: options.verbose, headless });
        for await (const event of agent.stream(prompt, buildStreamOptions(sessionId))) {
          const { stdout, stderr } = formatter.formatSplit(event);
          if (stdout) process.stdout.write(stdout);
          if (stderr) process.stderr.write(stderr);
        }
        const { stdout, stderr } = formatter.finalizeSplit();
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
      } else {
        const result = await agent.run(prompt, buildStreamOptions(sessionId));
        process.stdout.write(`${result.content}\n`);
        if (result.usage && !headless) {
          process.stderr.write(`\n${formatUsage(result.usage)}\n`);
        }
      }
    } finally {
      await destroyCliAgent(agent, fileLogger);
    }
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
    process.exit(1);
  }
}
