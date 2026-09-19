import { startExecServer, parseListenAddress } from './server/server.js';
import { printExecServerLog } from './server/log.js';
import { PACKAGE_VERSION } from './version.js';

function readFlag(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) {
    return eq.slice(name.length + 1);
  }
  const idx = argv.indexOf(name);
  if (idx === -1) {
    return undefined;
  }
  return argv[idx + 1];
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

export async function runExecServerCli(argv = process.argv.slice(2)): Promise<void> {
  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    process.stdout.write(`agent-sdk-exec ${PACKAGE_VERSION}

Usage:
  agent-sdk-exec [--listen HOST:PORT] [--cwd DIR] [--token TOKEN]

Options:
  --listen   Listen address (default 127.0.0.1:8787). Also accepts ws://HOST:PORT
  --cwd      Workspace root; paths outside this directory are rejected
  --token    Shared bearer token
  --help     Show this help
`);
    return;
  }

  if (hasFlag(argv, '--version') || hasFlag(argv, '-V')) {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return;
  }

  const listen = readFlag(argv, '--listen') ?? '127.0.0.1:8787';
  const cwd = readFlag(argv, '--cwd');
  const token = readFlag(argv, '--token');
  const { host, port } = parseListenAddress(listen);

  const server = await startExecServer({ host, port, cwd, token, log: printExecServerLog });
  process.stdout.write(`exec-server listening on ${server.url}\n`);
  if (cwd) {
    process.stdout.write(`workspace root: ${cwd}\n`);
  }

  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

const isMain =
  process.argv[1]?.endsWith('cli.js') ||
  process.argv[1]?.endsWith('cli.cjs') ||
  process.argv[1]?.includes('agent-sdk-exec');

if (isMain) {
  runExecServerCli().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
