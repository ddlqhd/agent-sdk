import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export const MOCK_ASSISTANT_TEXT = 'mock-control-ok';
export const MOCK_TOOL_DONE_MARKER = 'mock-tool-done';

export type MockToolKind = 'glob-ls' | 'bash-pwd' | 'bash-ls';

export interface MockChatMessage {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
}

export interface MockCompletionRequest {
  stream?: boolean;
  messages?: MockChatMessage[];
  tools?: Array<{ function?: { name?: string } }>;
}

export interface MockRecordedRequest {
  stream: boolean;
  hasToolResult: boolean;
  lastUserText: string;
  toolNames: string[];
  reply: 'text' | 'tool';
  toolKind?: MockToolKind;
}

export interface MockOpenAIServer {
  url: string;
  port: number;
  requests: MockRecordedRequest[];
  close: () => Promise<void>;
}

function collectBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text?: unknown }).text ?? '');
      }
      return '';
    })
    .join('\n');
}

export function lastUserText(messages: MockChatMessage[] | undefined): string {
  if (!messages?.length) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      return messageText(messages[i]?.content);
    }
  }
  return '';
}

export function lastToolResultText(messages: MockChatMessage[] | undefined): string {
  if (!messages?.length) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'tool') {
      return messageText(messages[i]?.content);
    }
  }
  return '';
}

export function hasToolResult(messages: MockChatMessage[] | undefined): boolean {
  return Boolean(messages?.some((m) => m.role === 'tool'));
}

export function inferToolKind(userText: string): MockToolKind | undefined {
  const t = userText.toLowerCase();
  if (/\bpwd\b|working directory|print cwd/.test(t)) return 'bash-pwd';
  if (/\bls\b|list files|glob/.test(t)) return /\bls\b/.test(t) ? 'bash-ls' : 'glob-ls';
  return undefined;
}

function toolCallSpec(kind: MockToolKind): { name: string; args: Record<string, unknown> } {
  switch (kind) {
    case 'bash-pwd':
      return { name: 'Bash', args: { command: 'pwd' } };
    case 'bash-ls':
      return { name: 'Bash', args: { command: 'ls' } };
    case 'glob-ls':
    default:
      return { name: 'Glob', args: { pattern: '*' } };
  }
}

function writeSseLines(res: ServerResponse, payloads: unknown[]): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  for (const payload of payloads) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

function usageChunk(finish: 'stop' | 'tool_calls'): unknown {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: finish }],
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }
  };
}

function writeTextSse(res: ServerResponse, text: string): void {
  writeSseLines(res, [
    {
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]
    },
    usageChunk('stop')
  ]);
}

function writeToolSse(res: ServerResponse, kind: MockToolKind): void {
  const { name, args } = toolCallSpec(kind);
  const argJson = JSON.stringify(args);
  writeSseLines(res, [
    {
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `call_${kind}`,
                type: 'function',
                function: { name, arguments: '' }
              }
            ]
          },
          finish_reason: null
        }
      ]
    },
    {
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: argJson } }]
          },
          finish_reason: null
        }
      ]
    },
    usageChunk('tool_calls')
  ]);
}

function writeTextComplete(res: ServerResponse, text: string): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop'
        }
      ],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }
    })
  );
}

function writeToolComplete(res: ServerResponse, kind: MockToolKind): void {
  const { name, args } = toolCallSpec(kind);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: `call_${kind}`,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }
      ],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }
    })
  );
}

export function decideMockReply(body: MockCompletionRequest): {
  reply: 'text' | 'tool';
  text: string;
  toolKind?: MockToolKind;
} {
  const userText = lastUserText(body.messages);
  if (hasToolResult(body.messages)) {
    const toolOut = lastToolResultText(body.messages).replace(/\s+/g, ' ').trim();
    return {
      reply: 'text',
      text: `${MOCK_ASSISTANT_TEXT} ${MOCK_TOOL_DONE_MARKER} ${toolOut.slice(0, 180)}`
    };
  }
  const toolKind = inferToolKind(userText);
  if (toolKind) {
    return { reply: 'tool', text: '', toolKind };
  }
  return { reply: 'text', text: MOCK_ASSISTANT_TEXT };
}

/**
 * OpenAI-compatible `/chat/completions` that can emit a side-effect-free tool call
 * (Glob `*` ≈ ls, or Bash `pwd` / `ls`) then a final answer after the tool result.
 */
export async function startMockOpenAIServer(): Promise<MockOpenAIServer> {
  const requests: MockRecordedRequest[] = [];

  const server: Server = createServer(async (req, res) => {
    const path = req.url?.split('?')[0] ?? '';
    if (req.method === 'POST' && (path === '/chat/completions' || path === '/v1/chat/completions')) {
      let body: MockCompletionRequest = {};
      try {
        body = JSON.parse(await collectBody(req)) as MockCompletionRequest;
      } catch {
        body = {};
      }
      const stream = body.stream !== false;
      const decision = decideMockReply(body);
      requests.push({
        stream,
        hasToolResult: hasToolResult(body.messages),
        lastUserText: lastUserText(body.messages),
        toolNames: (body.tools ?? [])
          .map((t) => t.function?.name)
          .filter((n): n is string => Boolean(n)),
        reply: decision.reply,
        toolKind: decision.toolKind
      });
      if (decision.reply === 'tool' && decision.toolKind) {
        if (stream) writeToolSse(res, decision.toolKind);
        else writeToolComplete(res, decision.toolKind);
      } else if (stream) {
        writeTextSse(res, decision.text);
      } else {
        writeTextComplete(res, decision.text);
      }
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('mock OpenAI server failed to bind');
  }

  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    port: address.port,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
}
