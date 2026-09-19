import type { AskUserQuestionAnswer, AskUserQuestionItem, SessionCheckpoint } from '@ddlqhd/agent-sdk';
import { chatPreview } from '../../shared/log-utils.js';
import type { ClientMessage, ModelProvider, ServerMessage, WebUiDefaults } from '../../shared/ws-protocol.js';
import { initChatUi, formatToolArguments, truncateForChatSnippet } from './chat-ui.js';
import { initLayout } from './layout.js';
import { initSessionsUi } from './sessions-ui.js';
import { initSettingsUi } from './settings-ui.js';
import { initTheme, toggleTheme, currentTheme } from './theme.js';
import { shortId } from './util.js';

const app = document.querySelector<HTMLElement>('#app')!;
const detailsEl = document.querySelector<HTMLElement>('#details')!;
const connStatus = document.querySelector<HTMLParagraphElement>('#conn-status')!;
const btnReconnect = document.querySelector<HTMLButtonElement>('#btn-reconnect')!;
const btnTheme = document.querySelector<HTMLButtonElement>('#btn-theme')!;
const formConfig = document.querySelector<HTMLFormElement>('#form-config')!;
const cfgWarnings = document.querySelector<HTMLParagraphElement>('#cfg-warnings')!;
const cfgProvider = document.querySelector<HTMLSelectElement>('#cfg-provider')!;
const cfgModel = document.querySelector<HTMLInputElement>('#cfg-model')!;
const currentSessionEl = document.querySelector<HTMLElement>('#current-session')!;
const btnSessionNew = document.querySelector<HTMLButtonElement>('#btn-session-new')!;
const btnSessionFork = document.querySelector<HTMLButtonElement>('#btn-session-fork')!;
const btnSessionCheckpoints = document.querySelector<HTMLButtonElement>('#btn-session-checkpoints')!;
const sessionListEl = document.querySelector<HTMLUListElement>('#session-list')!;
const sessionSearchEl = document.querySelector<HTMLInputElement>('#session-search')!;
const checkpointListEl = document.querySelector<HTMLUListElement>('#checkpoint-list')!;
const checkpointPopover = document.querySelector<HTMLElement>('#checkpoint-popover')!;
const chatLog = document.querySelector<HTMLDivElement>('#chat-log')!;
const chatHero = document.querySelector<HTMLElement>('#chat-hero')!;
const formChat = document.querySelector<HTMLFormElement>('#form-chat')!;
const chatInput = document.querySelector<HTMLTextAreaElement>('#chat-input')!;
const chatUseRun = document.querySelector<HTMLInputElement>('#chat-use-run')!;
const btnSend = document.querySelector<HTMLButtonElement>('#btn-send')!;
const btnStop = document.querySelector<HTMLButtonElement>('#btn-stop')!;
const composerHint = document.querySelector<HTMLElement>('#composer-hint')!;
const composerError = document.querySelector<HTMLParagraphElement>('#composer-error')!;
const appBanner = document.querySelector<HTMLParagraphElement>('#app-banner')!;
const eventLog = document.querySelector<HTMLPreElement>('#event-log')!;
const btnEventsClear = document.querySelector<HTMLButtonElement>('#btn-events-clear')!;
const toolActivityLog = document.querySelector<HTMLDivElement>('#tool-activity-log')!;
const btnToolActivityClear = document.querySelector<HTMLButtonElement>('#btn-tool-activity-clear')!;
const tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
const panelTools = document.querySelector<HTMLDivElement>('#panel-tools')!;
const panelEvents = document.querySelector<HTMLDivElement>('#panel-events')!;

initTheme();

initSettingsUi({
  nav: document.querySelector<HTMLElement>('.settings-nav')!,
  panes: Array.from(document.querySelectorAll<HTMLElement>('.settings-pane'))
});

const layout = initLayout({
  app,
  details: detailsEl,
  sidebarToggle: document.querySelector<HTMLButtonElement>('#btn-sidebar-toggle')!,
  detailsToggle: document.querySelector<HTMLButtonElement>('#btn-details-toggle')!,
  settingsOpen: document.querySelector<HTMLButtonElement>('#btn-settings')!,
  settingsClose: document.querySelector<HTMLButtonElement>('#btn-settings-close')!,
  settingsOverlay: document.querySelector<HTMLElement>('#settings-overlay')!,
  checkpointBtn: btnSessionCheckpoints,
  checkpointPopover
});

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

const chatUi = initChatUi({
  logEl: chatLog,
  heroEl: chatHero,
  onToolFocus: () => {
    layout.openDetails();
    setActiveInspectorTab('tools');
  }
});

const sessionsUi = initSessionsUi({
  listEl: sessionListEl,
  searchEl: sessionSearchEl,
  onResume: (id) => {
    currentSessionId = id;
    refreshSessionLabel();
    sessionsUi.setCurrent(id);
    send({ type: 'sessions:resume', sessionId: id });
  },
  onFork: (id) => {
    send({ type: 'sessions:fork', sessionId: id });
  }
});

let ws: WebSocket | null = null;
let configured = false;
let currentSessionId: string | undefined;
let activeRequestId: string | null = null;
let eventFilter: 'all' | 'text' | 'tool' | 'other' = 'all';

const MODEL_HINTS: Record<ModelProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  ollama: 'nemotron-3-super:cloud'
};

const DEFAULT_MODEL_NAMES = new Set(Object.values(MODEL_HINTS));
const LOG_PREFIX = '[agent-sdk web]';

function logOutbound(msg: ClientMessage): void {
  switch (msg.type) {
    case 'hello':
      console.log(`${LOG_PREFIX} send hello`);
      break;
    case 'configure':
      console.log(
        `${LOG_PREFIX} send configure provider=${msg.provider} model=${msg.model} storage=${msg.storage} persist=${msg.persist === true} safeToolsOnly=${msg.safeToolsOnly === true} thinking=${msg.thinking !== undefined ? String(msg.thinking) : '(default)'} thinkingLevel=${msg.thinkingLevel ?? '(default)'}`
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
    case 'sessions:checkpoints':
      console.log(
        `${LOG_PREFIX} send sessions:checkpoints sessionId=${msg.sessionId ? `${msg.sessionId.slice(0, 8)}…` : '(active)'}`
      );
      break;
    case 'sessions:rewind':
      console.log(
        `${LOG_PREFIX} send sessions:rewind sessionId=${msg.sessionId ? `${msg.sessionId.slice(0, 8)}…` : '(active)'}`
      );
      break;
    case 'sessions:fork':
      console.log(
        `${LOG_PREFIX} send sessions:fork sessionId=${msg.sessionId ? `${msg.sessionId.slice(0, 8)}…` : '(active)'}`
      );
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
  connStatus.title = text;
}

function setBanner(text: string): void {
  appBanner.textContent = text;
  appBanner.hidden = !text;
}

function setComposerError(text: string): void {
  composerError.textContent = text;
  composerError.hidden = !text;
}

function refreshComposerHint(): void {
  const provider = cfgProvider.value;
  const model = cfgModel.value.trim();
  composerHint.textContent = model ? `${provider} · ${model}` : provider;
}

function refreshSessionLabel(): void {
  if (!currentSessionId) {
    currentSessionEl.textContent = '—';
    currentSessionEl.removeAttribute('title');
    return;
  }
  currentSessionEl.textContent = shortId(currentSessionId);
  currentSessionEl.title = currentSessionId;
  sessionsUi.setCurrent(currentSessionId);
}

function requestSessionList(): void {
  send({ type: 'sessions:list' });
}

function resetChatUiAfterDisconnect(): void {
  activeRequestId = null;
  btnStop.disabled = true;
  btnSend.disabled = false;
  chatUi.finishStreaming();
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
    console.error(`${LOG_PREFIX} ws error (is agent-sdk web running?)`);
    setConn('WebSocket 错误（请确认 agent-sdk web 已启动）');
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
          const labels = [...st.selected].sort((a, b) => a - b).map((i) => q.options[i]!.label);
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
      setBanner('');
      applyServerDefaults(msg.defaults);
      refreshComposerHint();
      setConn('正在构建 Agent…', false);
      send(readConfigureMessage(false));
      return;
    case 'ready':
      configured = true;
      cfgWarnings.textContent = msg.warnings?.length ? msg.warnings.join('\n') : '';
      setBanner(msg.warnings?.join(' · ') ?? '');
      setConn('就绪', true);
      if (msg.sessionId) currentSessionId = msg.sessionId;
      refreshSessionLabel();
      chatUi.clear();
      clearInspectorLogs();
      checkpointListEl.innerHTML = '';
      layout.closeCheckpoints();
      requestSessionList();
      return;
    case 'error':
      appendEventLine('error', { message: msg.message, detail: msg.detail });
      cfgWarnings.textContent = msg.message;
      setBanner(msg.message);
      if (!configured) {
        setConn('请修正设置后点击「应用配置」', false);
        layout.openSettings();
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
        chatUi.finishStreaming();
      }
      return;
    case 'chat_done':
      activeRequestId = null;
      btnStop.disabled = true;
      btnSend.disabled = false;
      chatUi.finishStreaming();
      if (msg.sessionId) currentSessionId = msg.sessionId;
      refreshSessionLabel();
      appendEventLine('chat_done', { requestId: msg.requestId, usage: msg.usage });
      requestSessionList();
      return;
    case 'sessions:list':
      sessionsUi.render(msg.sessions, currentSessionId);
      return;
    case 'sessions:new':
      currentSessionId = msg.sessionId;
      refreshSessionLabel();
      activeRequestId = null;
      btnStop.disabled = true;
      btnSend.disabled = false;
      setBanner('');
      chatUi.clear();
      clearInspectorLogs();
      checkpointListEl.innerHTML = '';
      layout.closeCheckpoints();
      requestSessionList();
      return;
    case 'sessions:history':
      setBanner('');
      chatUi.renderHistory(msg.messages);
      clearInspectorLogs();
      return;
    case 'sessions:checkpoints':
      renderCheckpointList(msg.checkpoints);
      layout.openCheckpoints();
      return;
    case 'sessions:rewind':
      currentSessionId = msg.sessionId;
      refreshSessionLabel();
      setBanner('');
      chatUi.renderHistory(msg.messages);
      appendEventLine('sessions:rewind', msg.result);
      layout.closeCheckpoints();
      return;
    case 'sessions:fork':
      currentSessionId = msg.sessionId;
      refreshSessionLabel();
      setBanner('');
      chatUi.renderHistory(msg.messages);
      appendEventLine('sessions:fork', msg.result);
      checkpointListEl.innerHTML = '';
      layout.closeCheckpoints();
      requestSessionList();
      return;
    default:
      appendEventLine('unknown', msg);
  }
}

function clearInspectorLogs(): void {
  eventLog.textContent = '';
  toolActivityLog.innerHTML = '';
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
    chatUi.appendAssistant(`[Error] ${msg}`);
    return;
  }
  if (t === 'tool_call_start' || t === 'tool_call_delta' || t === 'tool_call_end') {
    if (t === 'tool_call_start') {
      chatUi.finishStreaming();
    }
    return;
  }

  if (t === 'tool_call') {
    const name = typeof event.name === 'string' ? event.name : '(unknown tool)';
    const id = typeof event.id === 'string' ? event.id : '';
    const body = truncateForChatSnippet(formatToolArguments(event.arguments)) || '{}';
    chatUi.upsertTool(id || name, name, 'call', body);
    appendToolActivityCard('call', name, id ? `id ${id}` : undefined, body);
    layout.openDetails();
    setActiveInspectorTab('tools');
    return;
  }

  if (t === 'tool_result') {
    const id = typeof event.toolCallId === 'string' ? event.toolCallId : '?';
    const result = typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? '');
    chatUi.upsertTool(id, '工具结果', 'result', result);
    appendToolActivityCard('result', '返回', `toolCallId ${id}`, truncateForChatSnippet(result));
    layout.openDetails();
    setActiveInspectorTab('tools');
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
    chatUi.upsertTool(id, '工具错误', 'error', msg);
    appendToolActivityCard('error', '执行失败', `toolCallId ${id}`, truncateForChatSnippet(msg));
    layout.openDetails();
    setActiveInspectorTab('tools');
    return;
  }

  if (t === 'thinking_start') {
    chatUi.appendThinkingDelta('');
    return;
  }

  if (t === 'thinking_end') {
    chatUi.endThinking();
    return;
  }

  if (t === 'thinking' && typeof event.content === 'string') {
    chatUi.appendThinkingDelta(event.content);
    return;
  }

  if (t === 'text_delta' && typeof event.content === 'string') {
    chatUi.appendAssistantDelta(event.content);
  }
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
  const line = `[${new Date().toISOString().slice(11, 23)}] ${kind} ${JSON.stringify(payload, null, 0).slice(0, 2000)}\n`;
  eventLog.textContent += line;
  eventLog.scrollTop = eventLog.scrollHeight;
}

function renderCheckpointList(checkpoints: SessionCheckpoint[]): void {
  checkpointListEl.innerHTML = '';
  if (checkpoints.length === 0) {
    const li = document.createElement('li');
    li.textContent = '无检查点';
    checkpointListEl.appendChild(li);
    return;
  }
  for (const c of checkpoints) {
    const li = document.createElement('li');
    const preview = document.createElement('div');
    preview.className = 'checkpoint-preview';
    preview.textContent = c.preview;
    const meta = document.createElement('div');
    meta.className = 'checkpoint-meta';
    const turn = document.createElement('span');
    turn.className = 'checkpoint-badge';
    turn.textContent = `#${c.userTurnIndex}`;
    meta.appendChild(turn);
    if (c.summariesAfter && c.summariesAfter > 0) {
      const sum = document.createElement('span');
      sum.className = 'checkpoint-badge';
      sum.textContent = `压缩×${c.summariesAfter}`;
      meta.appendChild(sum);
    }
    const actions = document.createElement('div');
    actions.className = 'checkpoint-actions';
    const btnRewind = document.createElement('button');
    btnRewind.type = 'button';
    btnRewind.className = 'btn btn-secondary';
    btnRewind.textContent = '回退';
    btnRewind.addEventListener('click', () => {
      send({
        type: 'sessions:rewind',
        sessionId: currentSessionId,
        userTurnIndex: c.userTurnIndex
      });
    });
    const btnFork = document.createElement('button');
    btnFork.type = 'button';
    btnFork.className = 'btn btn-secondary';
    btnFork.textContent = '分支';
    btnFork.addEventListener('click', () => {
      send({
        type: 'sessions:fork',
        sessionId: currentSessionId,
        userTurnIndex: c.userTurnIndex
      });
    });
    actions.appendChild(btnRewind);
    actions.appendChild(btnFork);
    li.appendChild(preview);
    li.appendChild(meta);
    li.appendChild(actions);
    checkpointListEl.appendChild(li);
  }
}

function applyServerDefaults(defaults?: WebUiDefaults): void {
  if (!defaults) return;
  if (defaults.provider) {
    cfgProvider.value = defaults.provider;
    if (defaults.model) {
      cfgModel.value = defaults.model;
    } else if (cfgModel.value.trim() === '' || DEFAULT_MODEL_NAMES.has(cfgModel.value)) {
      cfgModel.value = MODEL_HINTS[defaults.provider];
    }
  } else if (defaults.model) {
    cfgModel.value = defaults.model;
  }
  const cwdInput = formConfig.querySelector<HTMLInputElement>('[name="cwd"]');
  const userInput = formConfig.querySelector<HTMLInputElement>('[name="userBasePath"]');
  const mcpInput = formConfig.querySelector<HTMLInputElement>('[name="mcpConfigPath"]');
  const tempInput = formConfig.querySelector<HTMLInputElement>('[name="temperature"]');
  const ctxInput = formConfig.querySelector<HTMLInputElement>('[name="contextLength"]');
  const storageSelect = formConfig.querySelector<HTMLSelectElement>('[name="storage"]');
  const safeTools = formConfig.querySelector<HTMLInputElement>('[name="safeToolsOnly"]');
  const memory = formConfig.querySelector<HTMLInputElement>('[name="memory"]');
  const contextManagement = formConfig.querySelector<HTMLInputElement>('[name="contextManagement"]');
  const thinkingSelect = formConfig.querySelector<HTMLSelectElement>('[name="thinking"]');
  const thinkingLevelSelect = formConfig.querySelector<HTMLSelectElement>('[name="thinkingLevel"]');
  if (cwdInput && defaults.cwd) cwdInput.placeholder = defaults.cwd;
  if (userInput && defaults.userBasePath) userInput.placeholder = defaults.userBasePath;
  if (mcpInput) {
    if (defaults.mcpConfigPath) mcpInput.value = defaults.mcpConfigPath;
    else mcpInput.placeholder = mcpInput.placeholder || '可选，相对工作目录';
  }
  if (tempInput && defaults.temperature !== undefined) tempInput.value = String(defaults.temperature);
  if (ctxInput && defaults.contextLength !== undefined) ctxInput.value = String(defaults.contextLength);
  if (storageSelect && defaults.storage) storageSelect.value = defaults.storage;
  if (safeTools && defaults.safeToolsOnly !== undefined) safeTools.checked = defaults.safeToolsOnly;
  if (memory && defaults.memory !== undefined) memory.checked = defaults.memory;
  if (contextManagement && defaults.contextManagement !== undefined) {
    contextManagement.checked = defaults.contextManagement;
  }
  if (thinkingSelect && defaults.thinking !== undefined) {
    thinkingSelect.value = defaults.thinking ? 'true' : 'false';
  }
  if (thinkingLevelSelect && defaults.thinkingLevel) {
    thinkingLevelSelect.value = defaults.thinkingLevel;
  }
}

function readConfigureMessage(persist = false): ClientMessage {
  const fd = new FormData(formConfig);
  const provider = String(fd.get('provider') || 'ollama') as ModelProvider;
  const model = String(fd.get('model') || MODEL_HINTS[provider]);
  const temperature = fd.get('temperature') ? Number(fd.get('temperature')) : undefined;
  const rawCtxLen = String(fd.get('contextLength') ?? '').trim();
  const contextLengthParsed = rawCtxLen !== '' ? Number(rawCtxLen) : undefined;
  const contextLength =
    contextLengthParsed !== undefined && Number.isFinite(contextLengthParsed) && contextLengthParsed > 0
      ? contextLengthParsed
      : undefined;
  const storage = (String(fd.get('storage') || 'memory') === 'jsonl' ? 'jsonl' : 'memory') as 'memory' | 'jsonl';
  const safeToolsOnly = formConfig.querySelector<HTMLInputElement>('[name="safeToolsOnly"]')!.checked;
  const memory = formConfig.querySelector<HTMLInputElement>('[name="memory"]')!.checked;
  const contextManagement = formConfig.querySelector<HTMLInputElement>('[name="contextManagement"]')!.checked;
  const cwd = String(fd.get('cwd') || '').trim() || undefined;
  const userBasePath = String(fd.get('userBasePath') || '').trim() || undefined;
  const mcpConfigPath = String(fd.get('mcpConfigPath') || '').trim() || undefined;

  let thinking: boolean | undefined;
  const rawThinking = String(fd.get('thinking') ?? '').trim();
  if (rawThinking === 'true') thinking = true;
  else if (rawThinking === 'false') thinking = false;

  let thinkingLevel: 'low' | 'medium' | 'high' | undefined;
  const rawLevel = String(fd.get('thinkingLevel') ?? '').trim();
  if (rawLevel === 'low' || rawLevel === 'medium' || rawLevel === 'high') {
    thinkingLevel = rawLevel;
  }

  return {
    type: 'configure',
    provider,
    model,
    temperature,
    ...(contextLength !== undefined ? { contextLength } : {}),
    storage,
    safeToolsOnly,
    memory,
    contextManagement,
    cwd,
    userBasePath,
    mcpConfigPath,
    ...(thinking !== undefined ? { thinking } : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    ...(persist ? { persist: true } : {})
  };
}

function syncThemeButton(): void {
  const theme = currentTheme();
  btnTheme.title = theme === 'dark' ? '切换为浅色' : '切换为暗色';
  btnTheme.setAttribute('aria-label', btnTheme.title);
}

cfgProvider.addEventListener('change', () => {
  const p = cfgProvider.value as ModelProvider;
  const hint = MODEL_HINTS[p];
  if (['gpt-4', 'gpt-4o'].some((x) => cfgModel.value.includes(x)) && p !== 'openai') {
    cfgModel.value = hint;
    refreshComposerHint();
    return;
  }
  if (cfgModel.value.trim() === '' || cfgModel.value === hint || DEFAULT_MODEL_NAMES.has(cfgModel.value)) {
    cfgModel.value = hint;
  }
  refreshComposerHint();
});

cfgModel.addEventListener('input', () => refreshComposerHint());

formConfig.addEventListener('submit', (e) => {
  e.preventDefault();
  cfgWarnings.textContent = '';
  setBanner('');
  setConn('正在构建 Agent…', false);
  configured = false;
  chatUi.clear();
  clearInspectorLogs();
  checkpointListEl.innerHTML = '';
  layout.closeCheckpoints();
  layout.closeSettings();
  send(readConfigureMessage(true));
  refreshComposerHint();
});

btnReconnect.addEventListener('click', () => connect());

btnTheme.addEventListener('click', () => {
  toggleTheme();
  syncThemeButton();
});

btnSessionNew.addEventListener('click', () => {
  send({ type: 'sessions:new' });
});

btnSessionFork.addEventListener('click', () => {
  send({ type: 'sessions:fork', sessionId: currentSessionId });
});

btnSessionCheckpoints.addEventListener('click', () => {
  if (!checkpointPopover.hidden) {
    layout.closeCheckpoints();
    return;
  }
  send({ type: 'sessions:checkpoints', sessionId: currentSessionId });
});

formChat.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  if (ws?.readyState !== WebSocket.OPEN) {
    setComposerError('未连接：请点击重新连接或启动服务端（端口 3001）。');
    return;
  }
  if (!configured) {
    setComposerError('请先在设置中应用配置。');
    layout.openSettings();
    return;
  }
  setComposerError('');
  chatInput.value = '';
  chatUi.appendUser(text);
  chatUi.finishStreaming();

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

syncThemeButton();
refreshComposerHint();
connect();
