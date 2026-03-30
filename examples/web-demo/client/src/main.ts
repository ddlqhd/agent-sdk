import type { ClientMessage, ModelProvider, ServerMessage, SessionListItem } from '../../shared/ws-protocol.js';

const connStatus = document.querySelector<HTMLParagraphElement>('#conn-status')!;
const btnReconnect = document.querySelector<HTMLButtonElement>('#btn-reconnect')!;
const formConfig = document.querySelector<HTMLFormElement>('#form-config')!;
const cfgWarnings = document.querySelector<HTMLParagraphElement>('#cfg-warnings')!;
const cfgProvider = document.querySelector<HTMLSelectElement>('#cfg-provider')!;
const cfgModel = document.querySelector<HTMLInputElement>('#cfg-model')!;
const currentSessionEl = document.querySelector<HTMLElement>('#current-session')!;
const btnSessionNew = document.querySelector<HTMLButtonElement>('#btn-session-new')!;
const btnSessionList = document.querySelector<HTMLButtonElement>('#btn-session-list')!;
const sessionListEl = document.querySelector<HTMLUListElement>('#session-list')!;
const chatLog = document.querySelector<HTMLDivElement>('#chat-log')!;
const formChat = document.querySelector<HTMLFormElement>('#form-chat')!;
const chatInput = document.querySelector<HTMLTextAreaElement>('#chat-input')!;
const chatUseRun = document.querySelector<HTMLInputElement>('#chat-use-run')!;
const btnSend = document.querySelector<HTMLButtonElement>('#btn-send')!;
const btnStop = document.querySelector<HTMLButtonElement>('#btn-stop')!;
const eventLog = document.querySelector<HTMLPreElement>('#event-log')!;
const btnEventsClear = document.querySelector<HTMLButtonElement>('#btn-events-clear')!;

let ws: WebSocket | null = null;
let configured = false;
let currentSessionId: string | undefined;
let activeRequestId: string | null = null;
let eventFilter: 'all' | 'text' | 'tool' | 'other' = 'all';
/** Body element of the assistant bubble currently receiving streamed text; null when idle. */
let streamingAssistantBodyEl: HTMLElement | null = null;

const MAX_TOOL_SNIPPET_CHARS = 14_000;

const MODEL_HINTS: Record<ModelProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  ollama: 'glm-5:cloud'
};

const DEFAULT_MODEL_NAMES = new Set(Object.values(MODEL_HINTS));

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function setConn(text: string, ready = false): void {
  connStatus.textContent = text;
  connStatus.classList.toggle('ready', ready);
}

function resetChatUiAfterDisconnect(): void {
  activeRequestId = null;
  btnStop.disabled = true;
  btnSend.disabled = false;
  finishStreamingAssistant();
}

function connect(): void {
  ws?.close();
  configured = false;
  resetChatUiAfterDisconnect();
  setConn('Connecting…');
  ws = new WebSocket(wsUrl());

  ws.addEventListener('open', () => {
    // Socket is open; agent is not ready until the server sends `ready` after `configure`.
    setConn('Connected — handshake…', false);
    send({ type: 'hello', clientVersion: '0.1' });
  });

  ws.addEventListener('close', () => {
    setConn('Disconnected');
    configured = false;
    resetChatUiAfterDisconnect();
  });

  ws.addEventListener('error', () => {
    setConn('WebSocket error (is the server running on :3001?)');
  });

  ws.addEventListener('message', (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data)) as ServerMessage;
    } catch {
      appendEventLine('error', { parseError: true, raw: ev.data });
      return;
    }
    handleServerMessage(msg);
  });
}

function send(msg: ClientMessage): void {
  if (ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'hello_ok':
      cfgWarnings.textContent = '';
      setConn('Building agent…', false);
      send(readConfigureMessage());
      return;
    case 'ready':
      configured = true;
      cfgWarnings.textContent = msg.warnings?.length ? msg.warnings.join('\n') : '';
      setConn('Ready to chat', true);
      if (msg.sessionId) currentSessionId = msg.sessionId;
      refreshSessionLabel();
      return;
    case 'error':
      appendEventLine('error', { message: msg.message, detail: msg.detail });
      cfgWarnings.textContent = msg.message;
      if (!configured) {
        setConn('Connected — fix settings below, then Apply configuration', false);
      }
      return;
    case 'stream_event':
      logStreamEvent(msg.event);
      handleStreamEventInChatLog(msg.event);
      if (msg.event.type === 'end') {
        finishStreamingAssistant();
      }
      return;
    case 'chat_done':
      activeRequestId = null;
      btnStop.disabled = true;
      btnSend.disabled = false;
      finishStreamingAssistant();
      if (msg.sessionId) currentSessionId = msg.sessionId;
      refreshSessionLabel();
      appendEventLine('chat_done', { requestId: msg.requestId, usage: msg.usage });
      return;
    case 'sessions:list':
      renderSessionList(msg.sessions);
      return;
    case 'sessions:new':
      currentSessionId = msg.sessionId;
      refreshSessionLabel();
      return;
    default:
      appendEventLine('unknown', msg);
  }
}

function refreshSessionLabel(): void {
  currentSessionEl.textContent = currentSessionId || '—';
}

function ensureStreamingAssistantBubble(): HTMLElement {
  if (streamingAssistantBodyEl?.isConnected) {
    return streamingAssistantBodyEl;
  }
  const div = document.createElement('div');
  div.className = 'msg assistant';
  const role = document.createElement('div');
  role.className = 'role';
  role.textContent = 'assistant';
  const body = document.createElement('span');
  body.className = 'msg-body';
  div.appendChild(role);
  div.appendChild(body);
  chatLog.appendChild(div);
  streamingAssistantBodyEl = body;
  return body;
}

function appendAssistantStreamDelta(chunk: string): void {
  const body = ensureStreamingAssistantBubble();
  body.textContent += chunk;
  chatLog.scrollTop = chatLog.scrollHeight;
}

function finishStreamingAssistant(): void {
  streamingAssistantBodyEl = null;
}

function truncateForChatSnippet(text: string, max = MAX_TOOL_SNIPPET_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n… (truncated, ${text.length} chars total)`;
}

function formatToolArguments(args: unknown): string {
  if (args === undefined) return '';
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}

/** End assistant text before tool UI so deltas are not appended to the wrong bubble. */
function beforeToolUiInChat(): void {
  finishStreamingAssistant();
}

function appendToolCallChatRow(event: Record<string, unknown>): void {
  const name = typeof event.name === 'string' ? event.name : '(unknown tool)';
  const id = typeof event.id === 'string' ? event.id : '';
  const argsText = truncateForChatSnippet(formatToolArguments(event.arguments));

  const div = document.createElement('div');
  div.className = 'msg tool-call';

  const role = document.createElement('div');
  role.className = 'role';
  role.textContent = 'tool call';

  const title = document.createElement('div');
  title.className = 'msg-tool-title';
  title.textContent = name;

  div.appendChild(role);
  div.appendChild(title);
  if (id) {
    const idEl = document.createElement('div');
    idEl.className = 'msg-tool-id';
    idEl.textContent = `id ${shortId(id)}`;
    div.appendChild(idEl);
  }

  const pre = document.createElement('pre');
  pre.className = 'msg-tool-pre';
  pre.textContent = argsText || '{}';
  div.appendChild(pre);

  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function appendToolResultChatRow(toolCallId: string, body: string, variant: 'result' | 'error'): void {
  const div = document.createElement('div');
  div.className = variant === 'error' ? 'msg tool-result tool-result-error' : 'msg tool-result';

  const role = document.createElement('div');
  role.className = 'role';
  role.textContent = variant === 'error' ? 'tool error' : 'tool result';

  const idEl = document.createElement('div');
  idEl.className = 'msg-tool-id';
  idEl.textContent = `toolCallId ${shortId(toolCallId)}`;

  const pre = document.createElement('pre');
  pre.className = 'msg-tool-pre';
  pre.textContent = truncateForChatSnippet(body);

  div.appendChild(role);
  div.appendChild(idEl);
  div.appendChild(pre);
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function handleStreamEventInChatLog(event: Record<string, unknown>): void {
  const t = event.type;
  if (t === 'tool_call_start' || t === 'tool_call_delta' || t === 'tool_call_end') {
    if (t === 'tool_call_start') {
      beforeToolUiInChat();
    }
    return;
  }

  if (t === 'tool_call') {
    beforeToolUiInChat();
    appendToolCallChatRow(event);
    return;
  }

  if (t === 'tool_result') {
    const id = typeof event.toolCallId === 'string' ? event.toolCallId : '?';
    const result = typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? '');
    appendToolResultChatRow(id, result, 'result');
    return;
  }

  if (t === 'tool_error') {
    const id = typeof event.toolCallId === 'string' ? event.toolCallId : '?';
    const err = event.error as Record<string, unknown> | undefined;
    const msg =
      err && typeof err.message === 'string'
        ? err.message
        : typeof event.message === 'string'
          ? event.message
          : JSON.stringify(event);
    appendToolResultChatRow(id, msg, 'error');
    return;
  }

  if (t === 'text_delta' && typeof event.content === 'string') {
    appendAssistantStreamDelta(event.content);
  }
}

function appendChatMessage(role: 'user' | 'assistant', text: string): void {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (role === 'user') {
    div.innerHTML = `<div class="role">${role}</div>${escapeHtml(text)}`;
  } else {
    const roleEl = document.createElement('div');
    roleEl.className = 'role';
    roleEl.textContent = role;
    const body = document.createElement('span');
    body.className = 'msg-body';
    body.textContent = text;
    div.appendChild(roleEl);
    div.appendChild(body);
  }
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function eventCategory(type: string): 'text' | 'tool' | 'other' {
  if (type.startsWith('text_')) return 'text';
  if (type.includes('tool')) return 'tool';
  return 'other';
}

function logStreamEvent(event: Record<string, unknown>): void {
  const t = String(event.type || '');
  const cat = eventCategory(t);
  if (eventFilter === 'all') {
    appendEventLine(t, event);
    return;
  }
  if (eventFilter === 'text' && cat !== 'text') return;
  if (eventFilter === 'tool' && cat !== 'tool') return;
  if (eventFilter === 'other' && cat !== 'other') return;
  appendEventLine(t, event);
}

function appendEventLine(kind: string, payload: unknown): void {
  const line =
    `[${new Date().toISOString().slice(11, 23)}] ${kind} ${JSON.stringify(payload, null, 0).slice(0, 2000)}\n`;
  eventLog.textContent += line;
  eventLog.scrollTop = eventLog.scrollHeight;
}

function renderSessionList(sessions: SessionListItem[]): void {
  sessionListEl.innerHTML = '';
  for (const s of sessions) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(s.id.slice(0, 8))}…</span><span>${s.messageCount} msgs</span>`;
    li.title = s.id;
    li.addEventListener('click', () => {
      currentSessionId = s.id;
      refreshSessionLabel();
      send({ type: 'sessions:resume', sessionId: s.id });
    });
    sessionListEl.appendChild(li);
  }
}

function readConfigureMessage(): ClientMessage {
  const fd = new FormData(formConfig);
  const provider = String(fd.get('provider') || 'ollama') as ModelProvider;
  const model = String(fd.get('model') || MODEL_HINTS[provider]);
  const temperature = fd.get('temperature') ? Number(fd.get('temperature')) : undefined;
  const maxTokens = fd.get('maxTokens') ? Number(fd.get('maxTokens')) : undefined;
  const storage = (String(fd.get('storage') || 'memory') === 'jsonl' ? 'jsonl' : 'memory') as
    | 'memory'
    | 'jsonl';
  const safeToolsOnly = formConfig.querySelector<HTMLInputElement>('[name="safeToolsOnly"]')!.checked;
  const memory = formConfig.querySelector<HTMLInputElement>('[name="memory"]')!.checked;
  const contextManagement = formConfig.querySelector<HTMLInputElement>('[name="contextManagement"]')!.checked;
  const cwd = String(fd.get('cwd') || '').trim() || undefined;
  const userBasePath = String(fd.get('userBasePath') || '').trim() || undefined;
  const mcpConfigPath = String(fd.get('mcpConfigPath') || '').trim() || undefined;

  return {
    type: 'configure',
    provider,
    model,
    temperature,
    maxTokens,
    storage,
    safeToolsOnly,
    memory,
    contextManagement,
    cwd,
    userBasePath,
    mcpConfigPath
  };
}

cfgProvider.addEventListener('change', () => {
  const p = cfgProvider.value as ModelProvider;
  const hint = MODEL_HINTS[p];
  if (['gpt-4', 'gpt-4o'].some((x) => cfgModel.value.includes(x)) && p !== 'openai') {
    cfgModel.value = hint;
    return;
  }
  if (cfgModel.value.trim() === '' || cfgModel.value === hint || DEFAULT_MODEL_NAMES.has(cfgModel.value)) {
    cfgModel.value = hint;
  }
});

formConfig.addEventListener('submit', (e) => {
  e.preventDefault();
  cfgWarnings.textContent = '';
  setConn('Building agent…', false);
  configured = false;
  send(readConfigureMessage());
});

btnReconnect.addEventListener('click', () => connect());

btnSessionNew.addEventListener('click', () => {
  send({ type: 'sessions:new' });
});

btnSessionList.addEventListener('click', () => {
  send({ type: 'sessions:list' });
});

formChat.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  if (ws?.readyState !== WebSocket.OPEN) {
    cfgWarnings.textContent = 'Not connected. Use Reconnect or start the server (port 3001).';
    return;
  }
  if (!configured) {
    cfgWarnings.textContent = 'Apply agent configuration first (left panel: Apply configuration).';
    return;
  }
  chatInput.value = '';
  appendChatMessage('user', text);
  finishStreamingAssistant();

  const requestId = crypto.randomUUID();
  activeRequestId = requestId;
  btnStop.disabled = false;
  btnSend.disabled = true;

  if (chatUseRun.checked) {
    send({ type: 'chat_run', text, sessionId: currentSessionId, requestId });
  } else {
    send({ type: 'chat', text, sessionId: currentSessionId, requestId });
  }
});

btnStop.addEventListener('click', () => {
  if (activeRequestId) {
    send({ type: 'cancel', requestId: activeRequestId });
  }
});

btnEventsClear.addEventListener('click', () => {
  eventLog.textContent = '';
});

document.querySelectorAll<HTMLButtonElement>('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const f = btn.dataset.filter as typeof eventFilter;
    if (f === 'all' || f === 'text' || f === 'tool' || f === 'other') eventFilter = f;
  });
});

connect();
