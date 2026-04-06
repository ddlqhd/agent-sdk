import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@ddlqhd/agent-sdk';
import { chatPreview } from '../../shared/log-utils.js';
import type { ClientMessage, ModelProvider, ServerMessage, SessionListItem } from '../../shared/ws-protocol.js';

const connStatus = document.querySelector<HTMLParagraphElement>('#conn-status')!;
const btnReconnect = document.querySelector<HTMLButtonElement>('#btn-reconnect')!;
const formConfig = document.querySelector<HTMLFormElement>('#form-config')!;
const cfgWarnings = document.querySelector<HTMLParagraphElement>('#cfg-warnings')!;
const cfgProvider = document.querySelector<HTMLSelectElement>('#cfg-provider')!;
const cfgOllamaThinkWrap = document.querySelector<HTMLLabelElement>('#cfg-ollama-think-wrap')!;
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
const toolActivityLog = document.querySelector<HTMLDivElement>('#tool-activity-log')!;
const btnToolActivityClear = document.querySelector<HTMLButtonElement>('#btn-tool-activity-clear')!;
const tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
const panelTools = document.querySelector<HTMLDivElement>('#panel-tools')!;
const panelEvents = document.querySelector<HTMLDivElement>('#panel-events')!;

let ws: WebSocket | null = null;
let configured = false;
let currentSessionId: string | undefined;
let activeRequestId: string | null = null;
let eventFilter: 'all' | 'text' | 'tool' | 'other' = 'all';
/** Assistant bubble receiving streamed output; null when idle. */
let streamingAssistantMsgEl: HTMLDivElement | null = null;
let streamingAssistantThinkingEl: HTMLPreElement | null = null;
let streamingAssistantBodyEl: HTMLSpanElement | null = null;

const MAX_TOOL_SNIPPET_CHARS = 14_000;

const MODEL_HINTS: Record<ModelProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  ollama: 'glm-5:cloud'
};

const DEFAULT_MODEL_NAMES = new Set(Object.values(MODEL_HINTS));

const LOG_PREFIX = '[web-demo]';

function logOutbound(msg: ClientMessage): void {
  switch (msg.type) {
    case 'hello':
      console.log(`${LOG_PREFIX} send hello`);
      break;
    case 'configure':
      console.log(
        `${LOG_PREFIX} send configure provider=${msg.provider} model=${msg.model} storage=${msg.storage} safeToolsOnly=${msg.safeToolsOnly === true} ollamaThink=${msg.ollamaThink !== undefined ? String(msg.ollamaThink) : '(default)'}`
      );
      break;
    case 'chat':
    case 'chat_run': {
      const { len, preview } = chatPreview(msg.text);
      console.log(
        `${LOG_PREFIX} send ${msg.type} requestId=${msg.requestId} sessionId=${msg.sessionId ? `${msg.sessionId.slice(0, 8)}…` : '(active)'} textLen=${len} preview=${JSON.stringify(preview)}`
      );
      break;
    }
    case 'cancel':
      console.log(`${LOG_PREFIX} send cancel requestId=${msg.requestId}`);
      break;
    case 'sessions:list':
      console.log(`${LOG_PREFIX} send sessions:list`);
      break;
    case 'sessions:new':
      console.log(`${LOG_PREFIX} send sessions:new sessionId=${msg.sessionId ?? '(auto)'}`);
      break;
    case 'sessions:resume':
      console.log(`${LOG_PREFIX} send sessions:resume sessionId=${msg.sessionId.slice(0, 8)}…`);
      break;
    case 'ask_user_question_reply':
      console.log(`${LOG_PREFIX} send ask_user_question_reply requestId=${msg.requestId}`);
      break;
    default: {
      const _u: never = msg;
      console.log(`${LOG_PREFIX} send`, _u);
    }
  }
}

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function setConn(text: string, ready = false): void {
  connStatus.textContent = text;
  connStatus.classList.toggle('ready', ready);
}

function setActiveInspectorTab(tab: 'tools' | 'events'): void {
  tabButtons.forEach((btn) => {
    const isTools = btn.dataset.tab === 'tools';
    const active = (tab === 'tools' && isTools) || (tab === 'events' && !isTools);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const showTools = tab === 'tools';
  panelTools.classList.toggle('active', showTools);
  panelTools.toggleAttribute('hidden', !showTools);
  panelEvents.classList.toggle('active', !showTools);
  panelEvents.toggleAttribute('hidden', showTools);
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
  setConn('连接中…');
  const url = wsUrl();
  console.log(`${LOG_PREFIX} connecting ${url}`);
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    console.log(`${LOG_PREFIX} ws open`);
    // Socket is open; agent is not ready until the server sends `ready` after `configure`.
    setConn('已连接 — 握手中…', false);
    send({ type: 'hello', clientVersion: '0.1' });
  });

  ws.addEventListener('close', (ev) => {
    console.log(`${LOG_PREFIX} ws close code=${ev.code} reason=${ev.reason || '(none)'}`);
    setConn('未连接');
    configured = false;
    resetChatUiAfterDisconnect();
  });

  ws.addEventListener('error', () => {
    console.error(`${LOG_PREFIX} ws error (is the server on :3001?)`);
    setConn('WebSocket 错误（请确认服务端 :3001 已启动）');
  });

  ws.addEventListener('message', (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data)) as ServerMessage;
    } catch {
      console.warn(`${LOG_PREFIX} invalid JSON from server`);
      appendEventLine('error', { parseError: true, raw: ev.data });
      return;
    }
    handleServerMessage(msg);
  });
}

function send(msg: ClientMessage): void {
  if (ws?.readyState !== WebSocket.OPEN) return;
  logOutbound(msg);
  ws.send(JSON.stringify(msg));
}

/**
 * Modal UI for AskUserQuestion — returns structured answers for the model tool.
 */
function showAskUserQuestionDialog(questions: AskUserQuestionItem[]): Promise<AskUserQuestionAnswer[]> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ask-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'ask-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const h = document.createElement('h2');
    h.className = 'ask-modal-title';
    h.textContent = '需要你的选择';
    modal.appendChild(h);

    type RowState =
      | { multi: false; choice: number | 'other' | null; otherText: string }
      | { multi: true; selected: Set<number>; otherText: string };

    const rows: RowState[] = questions.map((q) =>
      q.multiSelect
        ? { multi: true, selected: new Set<number>(), otherText: '' }
        : { multi: false, choice: null, otherText: '' }
    );

    const body = document.createElement('div');
    body.className = 'ask-modal-body';

    questions.forEach((q, qi) => {
      const section = document.createElement('section');
      section.className = 'ask-modal-section';
      const chip = document.createElement('span');
      chip.className = 'ask-modal-chip';
      chip.textContent = q.header;
      const pq = document.createElement('p');
      pq.className = 'ask-modal-question';
      pq.textContent = q.question;
      section.appendChild(chip);
      section.appendChild(pq);

      const st = rows[qi]!;

      if (!q.multiSelect) {
        const group = document.createElement('div');
        group.className = 'ask-modal-options';
        q.options.forEach((opt, oi) => {
          const label = document.createElement('label');
          label.className = 'ask-modal-option';
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = `aq-${qi}`;
          radio.addEventListener('change', () => {
            if (!st.multi) {
              st.choice = oi;
            }
          });
          label.appendChild(radio);
          const span = document.createElement('span');
          span.textContent = `${opt.label} — ${opt.description}`;
          label.appendChild(span);
          group.appendChild(label);
        });
        const otherLab = document.createElement('label');
        otherLab.className = 'ask-modal-option';
        const otherRadio = document.createElement('input');
        otherRadio.type = 'radio';
        otherRadio.name = `aq-${qi}`;
        const otherInp = document.createElement('input');
        otherInp.type = 'text';
        otherInp.className = 'ask-modal-other-input';
        otherInp.placeholder = '自定义回答';
        otherInp.autocomplete = 'off';
        otherRadio.addEventListener('change', () => {
          if (!st.multi) {
            st.choice = 'other';
          }
        });
        otherInp.addEventListener('input', () => {
          if (!st.multi) {
            st.otherText = otherInp.value;
          }
        });
        otherInp.addEventListener('focus', () => {
          otherRadio.checked = true;
          if (!st.multi) {
            st.choice = 'other';
          }
        });
        otherLab.appendChild(otherRadio);
        otherLab.appendChild(document.createTextNode(' Other — '));
        otherLab.appendChild(otherInp);
        group.appendChild(otherLab);
        section.appendChild(group);
      } else {
        const group = document.createElement('div');
        group.className = 'ask-modal-options';
        q.options.forEach((opt, oi) => {
          const label = document.createElement('label');
          label.className = 'ask-modal-option';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.addEventListener('change', () => {
            if (st.multi) {
              if (cb.checked) {
                st.selected.add(oi);
              } else {
                st.selected.delete(oi);
              }
            }
          });
          label.appendChild(cb);
          const span = document.createElement('span');
          span.textContent = `${opt.label} — ${opt.description}`;
          label.appendChild(span);
          group.appendChild(label);
        });
        const otherWrap = document.createElement('div');
        otherWrap.className = 'ask-modal-other-wrap';
        const otherInp = document.createElement('input');
        otherInp.type = 'text';
        otherInp.className = 'ask-modal-other-input ask-modal-other-input-block';
        otherInp.placeholder = 'Other：填写则作为自定义回答（忽略上方选项）';
        otherInp.autocomplete = 'off';
        otherInp.addEventListener('input', () => {
          if (st.multi) {
            st.otherText = otherInp.value;
          }
        });
        otherWrap.appendChild(otherInp);
        section.appendChild(group);
        section.appendChild(otherWrap);
      }

      body.appendChild(section);
    });

    modal.appendChild(body);

    function buildAnswers(): AskUserQuestionAnswer[] {
      return questions.map((q, qi) => {
        const st = rows[qi]!;
        if (!q.multiSelect) {
          if (!st.multi) {
            if (st.choice === 'other') {
              return { questionIndex: qi, selectedLabels: [], otherText: st.otherText };
            }
            if (typeof st.choice === 'number') {
              return {
                questionIndex: qi,
                selectedLabels: [q.options[st.choice]!.label]
              };
            }
            return { questionIndex: qi, selectedLabels: [], otherText: '(skipped)' };
          }
        }
        if (st.multi) {
          const trimmed = st.otherText.trim();
          if (trimmed !== '') {
            return { questionIndex: qi, selectedLabels: [], otherText: trimmed };
          }
          const labels = [...st.selected]
            .sort((a, b) => a - b)
            .map((i) => q.options[i]!.label);
          return { questionIndex: qi, selectedLabels: labels };
        }
        return { questionIndex: qi, selectedLabels: [], otherText: '(skipped)' };
      });
    }

    const footer = document.createElement('div');
    footer.className = 'ask-modal-footer';
    const btnSkip = document.createElement('button');
    btnSkip.type = 'button';
    btnSkip.className = 'btn btn-secondary';
    btnSkip.textContent = '跳过';
    const btnOk = document.createElement('button');
    btnOk.type = 'button';
    btnOk.className = 'btn btn-primary';
    btnOk.textContent = '提交';

    function finish(answers: AskUserQuestionAnswer[]): void {
      overlay.remove();
      resolve(answers);
    }

    btnSkip.addEventListener('click', () => {
      finish(
        questions.map((_, qi) => ({
          questionIndex: qi,
          selectedLabels: [] as string[],
          otherText: '(skipped)' as const
        }))
      );
    });
    btnOk.addEventListener('click', () => {
      finish(buildAnswers());
    });

    footer.appendChild(btnSkip);
    footer.appendChild(btnOk);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) {
        btnSkip.click();
      }
    });
  });
}

function handleServerMessage(msg: ServerMessage): void {
  if (msg.type === 'stream_event') {
    const ev = msg.event as Record<string, unknown>;
    const t = String(ev.type ?? '?');
    if (t !== 'text_delta' && t !== 'tool_call_delta') {
      console.log(`${LOG_PREFIX} recv stream_event type=${t}`);
    }
  } else {
    console.log(`${LOG_PREFIX} recv ${msg.type}`);
  }
  switch (msg.type) {
    case 'hello_ok':
      cfgWarnings.textContent = '';
      setConn('正在构建 Agent…', false);
      send(readConfigureMessage());
      return;
    case 'ready':
      configured = true;
      cfgWarnings.textContent = msg.warnings?.length ? msg.warnings.join('\n') : '';
      setConn('就绪', true);
      if (msg.sessionId) currentSessionId = msg.sessionId;
      refreshSessionLabel();
      return;
    case 'error':
      appendEventLine('error', { message: msg.message, detail: msg.detail });
      cfgWarnings.textContent = msg.message;
      if (!configured) {
        setConn('请修正左侧设置后点击「应用配置」', false);
      }
      return;
    case 'ask_user_question': {
      const prevDisabled = chatInput.disabled;
      chatInput.disabled = true;
      void showAskUserQuestionDialog(msg.questions)
        .then((answers) => {
          send({ type: 'ask_user_question_reply', requestId: msg.requestId, answers });
        })
        .finally(() => {
          chatInput.disabled = prevDisabled;
        });
      return;
    }
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
      activeRequestId = null;
      btnStop.disabled = true;
      btnSend.disabled = false;
      clearChatLog();
      clearInspectorLogs();
      return;
    default:
      appendEventLine('unknown', msg);
  }
}

function refreshSessionLabel(): void {
  currentSessionEl.textContent = currentSessionId || '—';
}

const CHAT_LOG_NEAR_BOTTOM_PX = 48;

function isChatLogNearBottom(thresholdPx = CHAT_LOG_NEAR_BOTTOM_PX): boolean {
  const { scrollHeight, scrollTop, clientHeight } = chatLog;
  return scrollHeight - scrollTop - clientHeight <= thresholdPx;
}

/** Call after `#chat-log` content grows; pass whether the user was already at the bottom *before* that update. */
function scrollChatLogToBottomIfPinned(wasNearBottomBeforeUpdate: boolean): void {
  if (wasNearBottomBeforeUpdate) {
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}

function ensureStreamingAssistantMsg(): HTMLDivElement {
  if (streamingAssistantMsgEl?.isConnected) {
    return streamingAssistantMsgEl;
  }
  const div = document.createElement('div');
  div.className = 'msg assistant';
  const role = document.createElement('div');
  role.className = 'role';
  role.textContent = '助手';
  div.appendChild(role);
  chatLog.appendChild(div);
  streamingAssistantMsgEl = div;
  streamingAssistantThinkingEl = null;
  streamingAssistantBodyEl = null;
  return div;
}

function appendThinkingStreamDelta(chunk: string): void {
  const pinned = isChatLogNearBottom();
  const msg = ensureStreamingAssistantMsg();
  if (!streamingAssistantThinkingEl) {
    const pre = document.createElement('pre');
    pre.className = 'msg-thinking';
    msg.appendChild(pre);
    streamingAssistantThinkingEl = pre;
  }
  streamingAssistantThinkingEl.textContent += chunk;
  scrollChatLogToBottomIfPinned(pinned);
}

function appendAssistantStreamDelta(chunk: string): void {
  const pinned = isChatLogNearBottom();
  const msg = ensureStreamingAssistantMsg();
  if (!streamingAssistantBodyEl) {
    const body = document.createElement('span');
    body.className = 'msg-body';
    msg.appendChild(body);
    streamingAssistantBodyEl = body;
  }
  streamingAssistantBodyEl.textContent += chunk;
  scrollChatLogToBottomIfPinned(pinned);
}

function finishStreamingAssistant(): void {
  streamingAssistantMsgEl = null;
  streamingAssistantThinkingEl = null;
  streamingAssistantBodyEl = null;
}

function clearChatLog(): void {
  chatLog.innerHTML = '';
  finishStreamingAssistant();
}

function clearInspectorLogs(): void {
  eventLog.textContent = '';
  toolActivityLog.innerHTML = '';
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
  role.textContent = '工具调用';

  const title = document.createElement('div');
  title.className = 'msg-tool-title';
  title.textContent = name;

  div.appendChild(role);
  div.appendChild(title);
  if (id) {
    const idEl = document.createElement('div');
    idEl.className = 'msg-tool-id';
    idEl.textContent = `id ${id}`;
    div.appendChild(idEl);
  }

  const pre = document.createElement('pre');
  pre.className = 'msg-tool-pre';
  pre.textContent = argsText || '{}';
  div.appendChild(pre);

  const pinned = isChatLogNearBottom();
  chatLog.appendChild(div);
  scrollChatLogToBottomIfPinned(pinned);
}

function appendToolResultChatRow(toolCallId: string, body: string, variant: 'result' | 'error'): void {
  const div = document.createElement('div');
  div.className = variant === 'error' ? 'msg tool-result tool-result-error' : 'msg tool-result';

  const role = document.createElement('div');
  role.className = 'role';
  role.textContent = variant === 'error' ? '工具错误' : '工具结果';

  const idEl = document.createElement('div');
  idEl.className = 'msg-tool-id';
  idEl.textContent = `toolCallId ${toolCallId}`;

  const pre = document.createElement('pre');
  pre.className = 'msg-tool-pre';
  pre.textContent = truncateForChatSnippet(body);

  div.appendChild(role);
  div.appendChild(idEl);
  div.appendChild(pre);
  const pinned = isChatLogNearBottom();
  chatLog.appendChild(div);
  scrollChatLogToBottomIfPinned(pinned);
}

function focusToolInspector(): void {
  setActiveInspectorTab('tools');
}

function appendToolActivityCard(
  kind: 'call' | 'result' | 'error',
  title: string,
  idLabel: string | undefined,
  body: string
): void {
  const card = document.createElement('article');
  card.className = 'tool-card';

  const header = document.createElement('div');
  header.className = 'tool-card-header';

  const nameEl = document.createElement('div');
  nameEl.className = 'tool-card-name';
  nameEl.textContent = title;

  const badge = document.createElement('span');
  badge.className =
    kind === 'call' ? 'tool-card-badge call' : kind === 'result' ? 'tool-card-badge result' : 'tool-card-badge error';
  badge.textContent = kind === 'call' ? '调用' : kind === 'result' ? '结果' : '错误';

  header.appendChild(nameEl);
  header.appendChild(badge);
  card.appendChild(header);

  if (idLabel) {
    const idEl = document.createElement('div');
    idEl.className = 'tool-card-id';
    idEl.textContent = idLabel;
    card.appendChild(idEl);
  }

  const pre = document.createElement('pre');
  pre.className = 'tool-card-pre';
  pre.textContent = body;
  card.appendChild(pre);

  toolActivityLog.appendChild(card);
  toolActivityLog.scrollTop = toolActivityLog.scrollHeight;
}

function handleStreamEventInChatLog(event: Record<string, unknown>): void {
  const t = event.type;
  if (t === 'end' && event.reason === 'error') {
    const err = event.error as { message?: string } | undefined;
    const msg = err && typeof err.message === 'string' ? err.message : 'Stream error';
    appendChatMessage('assistant', `[Error] ${msg}`);
    return;
  }
  if (t === 'tool_call_start' || t === 'tool_call_delta' || t === 'tool_call_end') {
    if (t === 'tool_call_start') {
      beforeToolUiInChat();
    }
    return;
  }

  if (t === 'tool_call') {
    beforeToolUiInChat();
    appendToolCallChatRow(event);
    const name = typeof event.name === 'string' ? event.name : '(unknown tool)';
    const id = typeof event.id === 'string' ? event.id : '';
    appendToolActivityCard(
      'call',
      name,
      id ? `id ${id}` : undefined,
      truncateForChatSnippet(formatToolArguments(event.arguments)) || '{}'
    );
    focusToolInspector();
    return;
  }

  if (t === 'tool_result') {
    const id = typeof event.toolCallId === 'string' ? event.toolCallId : '?';
    const result = typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? '');
    appendToolResultChatRow(id, result, 'result');
    appendToolActivityCard('result', '返回', `toolCallId ${id}`, truncateForChatSnippet(result));
    focusToolInspector();
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
    appendToolActivityCard('error', '执行失败', `toolCallId ${id}`, truncateForChatSnippet(msg));
    focusToolInspector();
    return;
  }

  if (t === 'thinking' && typeof event.content === 'string') {
    appendThinkingStreamDelta(event.content);
    return;
  }

  if (t === 'text_delta' && typeof event.content === 'string') {
    appendAssistantStreamDelta(event.content);
  }
}

function appendChatMessage(role: 'user' | 'assistant', text: string): void {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const roleLabel = role === 'user' ? '用户' : '助手';
  if (role === 'user') {
    div.innerHTML = `<div class="role">${roleLabel}</div>${escapeHtml(text)}`;
  } else {
    const roleEl = document.createElement('div');
    roleEl.className = 'role';
    roleEl.textContent = roleLabel;
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

  let ollamaThink: boolean | 'low' | 'medium' | 'high' | undefined;
  if (provider === 'ollama') {
    const raw = String(fd.get('ollamaThink') ?? '').trim();
    if (raw === 'true') ollamaThink = true;
    else if (raw === 'false') ollamaThink = false;
    else if (raw === 'low' || raw === 'medium' || raw === 'high') ollamaThink = raw;
  }

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
    mcpConfigPath,
    ...(ollamaThink !== undefined ? { ollamaThink } : {})
  };
}

function syncOllamaThinkVisibility(): void {
  cfgOllamaThinkWrap.hidden = cfgProvider.value !== 'ollama';
}

cfgProvider.addEventListener('change', () => {
  const p = cfgProvider.value as ModelProvider;
  const hint = MODEL_HINTS[p];
  syncOllamaThinkVisibility();
  if (['gpt-4', 'gpt-4o'].some((x) => cfgModel.value.includes(x)) && p !== 'openai') {
    cfgModel.value = hint;
    return;
  }
  if (cfgModel.value.trim() === '' || cfgModel.value === hint || DEFAULT_MODEL_NAMES.has(cfgModel.value)) {
    cfgModel.value = hint;
  }
});

syncOllamaThinkVisibility();

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
    cfgWarnings.textContent = '未连接：请点击「重新连接」或启动服务端（端口 3001）。';
    return;
  }
  if (!configured) {
    cfgWarnings.textContent = '请先点击左侧「应用配置」完成 Agent 配置。';
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

btnToolActivityClear.addEventListener('click', () => {
  toolActivityLog.innerHTML = '';
});

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab === 'tools' || tab === 'events') setActiveInspectorTab(tab);
  });
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  formChat.requestSubmit();
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
