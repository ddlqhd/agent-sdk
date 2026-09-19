import { Command } from 'commander';
import { runExecServerCli } from '@ddlqhd/agent-sdk-exec';

/**
 * Standalone execution-plane server (filesystem / process / HTTP on this machine).
 */
export function createExecServerCommand(): Command {
  return new Command('exec-server')
    .description('Start an exec-server that can run on a separate machine from the Agent')
    .option('--listen <address>', 'Listen address (default 127.0.0.1:8787)', '127.0.0.1:8787')
    .option('--cwd <path>', 'Workspace root; paths outside this directory are rejected')
    .option('--token <token>', 'Shared bearer token')
    .action(async (options: { listen?: string; cwd?: string; token?: string }) => {
      const argv = ['--listen', options.listen ?? '127.0.0.1:8787'];
      if (options.cwd) {
        argv.push('--cwd', options.cwd);
      }
      if (options.token) {
        argv.push('--token', options.token);
      }
      await runExecServerCli(argv);
    });
}
