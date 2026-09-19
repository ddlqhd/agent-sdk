import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Environment, ProcessHandle } from '@ddlqhd/agent-sdk-exec';

export interface EnvironmentStdioTransportOptions {
  environment: Environment;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  title?: string;
}

const POLL_WAIT_MS = 100;
/** Match the exec process-read cap so MCP JSON-RPC is not sliced at the Bash 32k default. */
export const MCP_STDIO_READ_LIMIT_CHARS = 2 * 1024 * 1024;
const textEncoder = new TextEncoder();

/**
 * MCP JSON-RPC stdio transport that runs the server process on an Environment
 * (typically a remote exec-server) instead of the control-plane process.
 */
export class EnvironmentStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private handle: ProcessHandle | undefined;
  private running = false;
  private closed = false;
  private buffer = '';
  private cursor = 0;
  private pollPromise: Promise<void> | undefined;

  constructor(private readonly options: EnvironmentStdioTransportOptions) {}

  async start(): Promise<void> {
    if (this.handle) {
      return;
    }
    const cwd = (this.options.cwd ?? '').trim() || this.options.environment.info.cwd;
    this.handle = await this.options.environment.process.start({
      command: this.options.command,
      args: this.options.args ?? [],
      cwd,
      env: {
        ...getDefaultEnvironment(),
        ...this.options.env
      },
      replaceEnv: true,
      background: true,
      pipeStdin: true,
      maxRingChars: MCP_STDIO_READ_LIMIT_CHARS,
      title: this.options.title
    });
    this.running = true;
    this.pollPromise = this.pollStdout();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.handle) {
      throw new Error('Environment stdio transport is not started');
    }
    const line = `${JSON.stringify(message)}\n`;
    await this.handle.write(textEncoder.encode(line));
  }

  async close(): Promise<void> {
    this.running = false;
    if (this.handle) {
      try {
        await this.handle.terminate({ killDelayMs: 500 });
      } catch {
        // ignore
      }
      this.handle = undefined;
    }
    await this.pollPromise?.catch(() => undefined);
    this.emitClose();
  }

  private emitClose(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.onclose?.();
  }

  private async pollStdout(): Promise<void> {
    while (this.running && this.handle) {
      try {
        const out = await this.handle.read({
          stream: 'stdout',
          sinceCursor: this.cursor,
          waitMs: POLL_WAIT_MS,
          raw: true,
          limitChars: MCP_STDIO_READ_LIMIT_CHARS
        });
        this.cursor = out.nextCursorStdout;
        if (out.content) {
          this.buffer += out.content;
          this.drainLines();
        }
        if (out.exited) {
          this.running = false;
          this.emitClose();
          return;
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.onerror?.(err);
        this.running = false;
        this.emitClose();
        return;
      }
    }
  }

  private drainLines(): void {
    while (this.running) {
      const idx = this.buffer.indexOf('\n');
      if (idx < 0) {
        return;
      }
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) {
        continue;
      }
      try {
        const message = JSON.parse(line) as JSONRPCMessage;
        this.onmessage?.(message);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.onerror?.(err);
      }
    }
  }
}
