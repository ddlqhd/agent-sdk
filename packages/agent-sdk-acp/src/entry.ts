#!/usr/bin/env node
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { AgentSdkAcpBridge } from './server.js';
import { installStderrLogging, logError, logInfo } from './logging.js';
import { ensureSdkBuilt } from './paths.js';
import { describeMissingKey, requireProviderKey, resolveProvider } from './env.js';

const VERSION = '0.1.0';

function parseArgs(argv: string[]): { check: boolean; version: boolean } {
  return {
    check: argv.includes('--check'),
    version: argv.includes('--version')
  };
}

async function preflight(): Promise<void> {
  ensureSdkBuilt();
  const provider = resolveProvider();
  const key = requireProviderKey(provider);
  if (provider !== 'ollama' && !key) {
    throw new Error(describeMissingKey(provider));
  }
}

async function main(): Promise<void> {
  installStderrLogging();
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    process.stderr.write(`agent-sdk-acp ${VERSION}\n`);
    return;
  }

  if (args.check) {
    await preflight();
    process.stderr.write('agent-sdk-acp: OK\n');
    return;
  }

  await preflight();
  logInfo('starting stdio ACP bridge', `provider=${resolveProvider()}`);

  const input = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(input, output);

  let bridge: AgentSdkAcpBridge | null = null;
  new acp.AgentSideConnection((conn) => {
    bridge = new AgentSdkAcpBridge(conn);
    return bridge;
  }, stream);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logInfo('shutting down', signal);
    try {
      await bridge?.sessionManager.destroyAll();
    } catch (e) {
      logError('shutdown', e);
    }
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logError('fatal', err);
  process.exit(1);
});
