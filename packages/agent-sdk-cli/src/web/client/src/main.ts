import type { AskUserQuestionAnswer, AskUserQuestionItem, SessionCheckpoint } from '@ddlqhd/agent-sdk';
import { chatPreview, formatBaseUrlForLog } from '../../shared/log-utils.js';
import type { ClientMessage, ModelProvider, ServerMessage, WebUiDefaults } from '../../shared/ws-protocol.js';
import { initChatUi, formatToolArguments, truncateForChatSnippet } from './chat-ui.js';
import { initLayout } from './layout.js';
import { initSessionsUi } from './sessions-ui.js';
import { initSettingsUi } from './settings-ui.js';
import { initTheme, toggleTheme, currentTheme } from './theme.js';

const app = document.querySelector<HTMLElement>('#app')!;
const detailsEl = document.querySelector<HTMLElement>('#details')!;
const connStatus = document.querySelector<HTMLParagraphElement>('#conn-status')!;
const btnReconnect = document.querySelector<HTMLButtonElement>('#btn-reconnect')!;
const btnTheme = document.querySelector<HTMLButtonElement>('#btn-theme')!;
const formConfig = document.querySelector<HTMLFormElement>('#form-config')!;
const cfgWarnings = document.querySelector<HTMLParagraphElement>('#cfg-warnings')!;
const cfgProvider = document.querySelector<HTMLSelectElement>('#cfg-provider')!;
const cfgModel = document.querySelector<HTMLInputElement>('#cfg-model')!;
const cfgBaseUrl = document.querySelector<HTMLInputElement>('#cfg-base-url')!;
const cfgApiKey = document.querySelector<HTMLInputElement>('#cfg-api-key')!;
const btnClearApiKey = document.querySelector<HTMLButtonElement>('#btn-clear-api-key')!;
const currentSessionEl = document.querySelector<HTMLElement>('#current-session')!;
const btnSessionMore = document.querySelector<HTMLButtonElement>('#btn-session-more')!;
const sessionMoreMenu = document.querySelector<HTMLElement>('#session-more-menu')!;
const btnCopySessionId = document.querySelector<HTMLButtonElement>('#btn-copy-session-id')!;
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
  heroEl: chatHero
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
  },
  onDelete: (id) => {
    const title = sessionsUi.titleOf(id)?.trim() || '新会话';
    void showConfirmDialog({
      title: '删除会话',
      message: `确定删除「${title}」？此操作无法撤销。`,
      confirmLabel: '删除',
      danger: true
    }).then((ok) => {
      if (!ok) return;
      send({ type: 'sessions:delete', sessionId: id });
    });
  }
});

let ws: WebSocket | null = null;
let configured = false;
let currentSessionId: string | undefined;
let activeRequestId: string | null = null;
let eventFilter: 'all' | 'text' | 'tool' | 'other' = 'all';
/** Fields the user has edited. A later hello_ok must not overwrite them. */
const dirtyFields = new Set<string>();
/** Provider last received from the server, used to drop secrets when the form provider changes. */
let seededProvider: ModelProvider | undefined;
/** Base URL last received from the server, restored if the user switches back before apply. */
let seededBaseUrl = '';
/** Mask from hello_ok, never the plaintext key. */
let savedApiKeyHint: string | undefined;
/** User asked to delete the saved key on the next configure. */
let clearApiKey = false;

function markFieldDirty(target: EventTarget | null): void {
  if (!(target instanceof HTMLElement)) return;
  const name = target.getAttribute('name');
  if (name) dirtyFields.add(name);
}

function isPristine(name: string): boolean {
  return !dirtyFields.has(name);
}

const MODEL_HINTS: Record<ModelProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  ollama: 'nemotron-3-super:cloud'
};

const BASE_URL_PLACEHOLDERS: Record<ModelProvider, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  ollama: 'http://127.0.0.1:11434'
};

const API_KEY_PLACEHOLDERS: Record<ModelProvider, string> = {
  openai: '留空则使用 OPENAI_API_KEY',
  anthropic: '留空则使用 ANTHROPIC_API_KEY',
  ollama: 'Ollama 通常不需要'
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
        `${LOG_PREFIX} send configure provider=${msg.provider} model=${msg.model} baseUrl=${formatBaseUrlForLog(msg.baseUrl)} apiKey=${msg.apiKey ? '(set)' : msg.apiKey === null ? '(cleared)' : '(default)'} storage=${msg.storage} persist=${msg.persist === true} safeToolsOnly=${msg.safeToolsOnly === true} thinking=${msg.thinking !== undefined ? String(msg.thinking) : '(default)'} thinkingLevel=${msg.thinkingLevel ?? '(default)'}`
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
    case 'sessions:delete':
      console.log(`${LOG_PREFIX} send sessions:delete sessionId=${msg.sessionId.slice(0, 8)}…`);
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

function baseUrlHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

function syncBaseUrlPlaceholder(): void {
  const provider = cfgProvider.value as ModelProvider;
  const sample = BASE_URL_PLACEHOLDERS[provider] ?? BASE_URL_PLACEHOLDERS.openai;
  cfgBaseUrl.placeholder = `留空则使用默认（${sample}）`;
}

function syncApiKeyPlaceholder(): void {
  const provider = cfgProvider.value as ModelProvider;
  const fallback = API_KEY_PLACEHOLDERS[provider] ?? API_KEY_PLACEHOLDERS.openai;
  if (clearApiKey) {
    cfgApiKey.placeholder = '应用后清除已保存的 Key，改用环境变量';
    return;
  }
  const hintApplies = savedApiKeyHint && (!seededProvider || provider === seededProvider);
  if (hintApplies && !cfgApiKey.value.trim()) {
    cfgApiKey.placeholder = `已保存 ${savedApiKeyHint}，留空保持不变`;
    return;
  }
  cfgApiKey.placeholder = fallback;
}

function refreshComposerHint(): void {
  const provider = cfgProvider.value;
  const model = cfgModel.value.trim();
  const host = baseUrlHost(cfgBaseUrl.value.trim());
  composerHint.textContent = [provider, model, host].filter(Boolean).join(' · ');
}

function setSessionMoreOpen(open: boolean): void {
  sessionMoreMenu.hidden = !open;
  btnSessionMore.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function closeSessionMore(): void {
  setSessionMoreOpen(false);
}

function refreshSessionLabel(): void {
  if (!currentSessionId) {
    currentSessionEl.textContent = '—';
    currentSessionEl.removeAttribute('title');
    btnSessionMore.disabled = true;
    closeSessionMore();
    return;
  }
  const title = sessionsUi.titleOf(currentSessionId)?.trim() || '新会话';
  currentSessionEl.textContent = title;
  currentSessionEl.title = title;
  btnSessionMore.disabled = false;
  sessionsUi.setCurrent(currentSessionId);
}

async function copySessionId(): Promise<void> {
  if (!currentSessionId) return;
  const id = currentSessionId;
  try {
    await navigator.clipboard.writeText(id);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = id;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const prev = btnCopySessionId.textContent;
  btnCopySessionId.textContent = '已复制';
  window.setTimeout(() => {
    btnCopySessionId.textContent = prev || '复制会话 ID';
    closeSessionMore();
  }, 900);
}

function requestSessionList(): void {
  send({ type: 'sessions:list' });
}

function resetChatUiAfterDisconnect(): void {
  activeRequestId = null;
  btnStop.disabled = true;
  btnSend.disabled = false;
  chatUi.finishStreaming();
  chatUi.setRunning(false);
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

function send(msg: ClientMessage): boolean {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  logOutbound(msg);
  ws.send(JSON.stringify(msg));
  return true;
}

function showConfirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ask-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'ask-modal confirm-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'confirm-modal-title');

    const h = document.createElement('h2');
    h.id = 'confirm-modal-title';
    h.className = 'ask-modal-title';
    h.textContent = opts.title;

    const p = document.createElement('p');
    p.className = 'confirm-modal-message';
    p.textContent = opts.message;

    const footer = document.createElement('div');
    footer.className = 'ask-modal-footer';
    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'btn btn-secondary';
    btnCancel.textContent = '取消';
    const btnOk = document.createElement('button');
    btnOk.type = 'button';
    btnOk.className = opts.danger === true ? 'btn btn-danger-outline' : 'btn btn-primary';
    btnOk.textContent = opts.confirmLabel ?? '确定';

    let settled = false;
    function finish(ok: boolean): void {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(ok);
    }

    function onKey(ev: KeyboardEvent): void {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(false);
      }
    }

    btnCancel.addEventListener('click', () => finish(false));
    btnOk.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) finish(false);
    });
    document.addEventListener('keydown', onKey);

    footer.appendChild(btnCancel);
    footer.appendChild(btnOk);
    modal.appendChild(h);
    modal.appendChild(p);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    btnCancel.focus();
  });
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
      resetToolStreamState();
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
      chatUi.setRunning(false);
      void showAskUserQuestionDialog(msg.questions)
        .then((answers) => {
          send({ type: 'ask_user_question_reply', requestId: msg.requestId, answers });
          if (activeRequestId) chatUi.setRunning(true);
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
      chatUi.setRunning(false);
      if (msg.sessionId) currentSessionId = msg.sessionId;
      refreshSessionLabel();
      appendEventLine('chat_done', { requestId: msg.requestId, usage: msg.usage });
      requestSessionList();
      return;
    case 'sessions:list':
      sessionsUi.render(msg.sessions, currentSessionId);
      refreshSessionLabel();
      return;
    case 'sessions:deleted':
      requestSessionList();
      return;
    case 'sessions:new':
      currentSessionId = msg.sessionId;
      refreshSessionLabel();
      activeRequestId = null;
      btnStop.disabled = true;
      btnSend.disabled = false;
      setBanner('');
      chatUi.clear();
      resetToolStreamState();
      clearInspectorLogs();
      checkpointListEl.innerHTML = '';
      layout.closeCheckpoints();
      requestSessionList();
      return;
    case 'sessions:history':
      setBanner('');
      resetToolStreamState();
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
      resetToolStreamState();
      chatUi.renderHistory(msg.messages);
      appendEventLine('sessions:rewind', msg.result);
      layout.closeCheckpoints();
      return;
    case 'sessions:fork':
      currentSessionId = msg.sessionId;
      refreshSessionLabel();
      setBanner('');
      resetToolStreamState();
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

const toolArgBuf = new Map<string, string>();
const toolNameById = new Map<string, string>();

function resetToolStreamState(): void {
  toolArgBuf.clear();
  toolNameById.clear();
}

function resolveToolId(event: Record<string, unknown>): string {
  if (typeof event.id === 'string' && event.id) return event.id;
  if (typeof event.toolCallId === 'string' && event.toolCallId) return event.toolCallId;
  if (typeof event.name === 'string' && event.name) return event.name;
  return '?';
}

function rememberToolName(id: string, name: string): void {
  const trimmed = name.trim();
  if (id && trimmed) toolNameById.set(id, trimmed);
}

function resolvedToolName(id: string, fallback = ''): string {
  return fallback.trim() || toolNameById.get(id) || '';
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
  if (t === 'tool_call_start') {
    const id = resolveToolId(event);
    const name = typeof event.name === 'string' ? event.name : '';
    rememberToolName(id, name);
    chatUi.upsertTool(id, resolvedToolName(id, name), 'call', toolArgBuf.get(id) || '');
    return;
  }

  if (t === 'tool_call_delta') {
    const id = resolveToolId(event);
    const chunk =
      typeof event.arguments === 'string' ? event.arguments : formatToolArguments(event.arguments);
    if (chunk) {
      toolArgBuf.set(id, `${toolArgBuf.get(id) ?? ''}${chunk}`);
    }
    chatUi.upsertTool(id, resolvedToolName(id), 'call', toolArgBuf.get(id) || '');
    return;
  }

  if (t === 'tool_call_end') {
    return;
  }

  if (t === 'tool_call') {
    const name = typeof event.name === 'string' ? event.name : '(unknown tool)';
    const id = resolveToolId(event);
    rememberToolName(id, name);
    const body = truncateForChatSnippet(formatToolArguments(event.arguments)) || toolArgBuf.get(id) || '{}';
    toolArgBuf.set(id, body);
    chatUi.upsertTool(id, resolvedToolName(id, name), 'call', body);
    appendToolActivityCard('call', resolvedToolName(id, name) || name, id !== '?' ? `id ${id}` : undefined, body);
    return;
  }

  if (t === 'tool_result') {
    const id = resolveToolId(event);
    const result = typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? '');
    chatUi.upsertTool(id, resolvedToolName(id), 'result', result);
    appendToolActivityCard('result', resolvedToolName(id) || '返回', `toolCallId ${id}`, truncateForChatSnippet(result));
    return;
  }

  if (t === 'tool_error') {
    const id = resolveToolId(event);
    const err = event.error as Record<string, unknown> | undefined;
    const msg =
      err && typeof err.message === 'string'
        ? err.message
        : typeof event.message === 'string'
          ? event.message
          : JSON.stringify(event);
    chatUi.upsertTool(id, resolvedToolName(id), 'error', msg);
    appendToolActivityCard('error', resolvedToolName(id) || '执行失败', `toolCallId ${id}`, truncateForChatSnippet(msg));
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
  seededProvider = defaults.provider ?? seededProvider;
  seededBaseUrl = defaults.baseUrl ?? '';
  savedApiKeyHint = defaults.hasApiKey ? defaults.apiKeyHint || '••••' : undefined;

  if (isPristine('provider') && defaults.provider) {
    cfgProvider.value = defaults.provider;
  }
  if (isPristine('model')) {
    if (defaults.model) {
      cfgModel.value = defaults.model;
    } else if (
      defaults.provider &&
      (cfgModel.value.trim() === '' || DEFAULT_MODEL_NAMES.has(cfgModel.value))
    ) {
      cfgModel.value = MODEL_HINTS[defaults.provider];
    }
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
  if (mcpInput && isPristine('mcpConfigPath')) {
    if (defaults.mcpConfigPath) mcpInput.value = defaults.mcpConfigPath;
    else mcpInput.placeholder = mcpInput.placeholder || '可选，相对工作目录';
  }
  if (tempInput && isPristine('temperature') && defaults.temperature !== undefined) {
    tempInput.value = String(defaults.temperature);
  }
  if (ctxInput && isPristine('contextLength') && defaults.contextLength !== undefined) {
    ctxInput.value = String(defaults.contextLength);
  }
  if (storageSelect && isPristine('storage') && defaults.storage) storageSelect.value = defaults.storage;
  if (safeTools && isPristine('safeToolsOnly') && defaults.safeToolsOnly !== undefined) {
    safeTools.checked = defaults.safeToolsOnly;
  }
  if (memory && isPristine('memory') && defaults.memory !== undefined) memory.checked = defaults.memory;
  if (contextManagement && isPristine('contextManagement') && defaults.contextManagement !== undefined) {
    contextManagement.checked = defaults.contextManagement;
  }
  if (thinkingSelect && isPristine('thinking') && defaults.thinking !== undefined) {
    thinkingSelect.value = defaults.thinking ? 'true' : 'false';
  }
  if (thinkingLevelSelect && isPristine('thinkingLevel') && defaults.thinkingLevel) {
    thinkingLevelSelect.value = defaults.thinkingLevel;
  }
  if (isPristine('baseUrl')) cfgBaseUrl.value = defaults.baseUrl ?? '';
  if (isPristine('apiKey')) {
    cfgApiKey.value = '';
    clearApiKey = false;
  }
  syncBaseUrlPlaceholder();
  syncApiKeyPlaceholder();
  refreshComposerHint();
}

function readApiKeyForConfigure(): string | null | undefined {
  const typed = cfgApiKey.value.trim();
  if (typed) return typed;
  if (clearApiKey) return null;
  const provider = cfgProvider.value as ModelProvider;
  if (seededProvider && provider !== seededProvider) return null;
  return undefined;
}

function readConfigureMessage(persist = false): ClientMessage {
  const fd = new FormData(formConfig);
  const provider = String(fd.get('provider') || 'ollama') as ModelProvider;
  const model = String(fd.get('model') || MODEL_HINTS[provider]);
  const baseUrl = String(fd.get('baseUrl') || '').trim() || null;
  const apiKey = readApiKeyForConfigure();
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
    baseUrl,
    ...(apiKey !== undefined ? { apiKey } : {}),
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

formConfig.addEventListener('input', (ev) => {
  markFieldDirty(ev.target);
  if (ev.target === cfgApiKey && cfgApiKey.value.trim()) clearApiKey = false;
});
formConfig.addEventListener('change', (ev) => {
  markFieldDirty(ev.target);
});

btnClearApiKey.addEventListener('click', () => {
  cfgApiKey.value = '';
  clearApiKey = true;
  dirtyFields.add('apiKey');
  syncApiKeyPlaceholder();
});

cfgProvider.addEventListener('change', () => {
  const p = cfgProvider.value as ModelProvider;
  cfgApiKey.value = '';
  dirtyFields.add('apiKey');
  cfgBaseUrl.value = seededProvider && p === seededProvider ? seededBaseUrl : '';
  dirtyFields.add('baseUrl');
  syncBaseUrlPlaceholder();
  syncApiKeyPlaceholder();
  const hint = MODEL_HINTS[p];
  if (['gpt-4', 'gpt-4o'].some((x) => cfgModel.value.includes(x)) && p !== 'openai') {
    cfgModel.value = hint;
    dirtyFields.add('model');
    refreshComposerHint();
    return;
  }
  if (cfgModel.value.trim() === '' || cfgModel.value === hint || DEFAULT_MODEL_NAMES.has(cfgModel.value)) {
    cfgModel.value = hint;
    dirtyFields.add('model');
  }
  refreshComposerHint();
});

cfgModel.addEventListener('input', () => refreshComposerHint());
cfgBaseUrl.addEventListener('input', () => refreshComposerHint());
syncBaseUrlPlaceholder();
syncApiKeyPlaceholder();

formConfig.addEventListener('submit', (e) => {
  e.preventDefault();
  cfgWarnings.textContent = '';
  setBanner('');
  setConn('正在构建 Agent…', false);
  configured = false;
  chatUi.clear();
  resetToolStreamState();
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
  closeSessionMore();
  if (!checkpointPopover.hidden) {
    layout.closeCheckpoints();
    return;
  }
  send({ type: 'sessions:checkpoints', sessionId: currentSessionId });
});

btnSessionMore.addEventListener('click', (ev) => {
  ev.stopPropagation();
  if (btnSessionMore.disabled) return;
  layout.closeCheckpoints();
  setSessionMoreOpen(sessionMoreMenu.hidden);
});

btnCopySessionId.addEventListener('click', () => {
  void copySessionId();
});

document.addEventListener('click', (ev) => {
  if (sessionMoreMenu.hidden) return;
  const t = ev.target;
  if (!(t instanceof Node)) return;
  if (sessionMoreMenu.contains(t) || btnSessionMore.contains(t)) return;
  closeSessionMore();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !sessionMoreMenu.hidden) {
    closeSessionMore();
  }
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

  const requestId = crypto.randomUUID();
  const sent = chatUseRun.checked
    ? send({ type: 'chat_run', text, sessionId: currentSessionId, requestId })
    : send({ type: 'chat', text, sessionId: currentSessionId, requestId });
  if (!sent) {
    setComposerError('未连接：请点击重新连接或启动服务端（端口 3001）。');
    return;
  }

  chatInput.value = '';
  chatUi.appendUser(text);
  chatUi.finishStreaming();
  activeRequestId = requestId;
  btnStop.disabled = false;
  btnSend.disabled = true;
  chatUi.setRunning(true);
});

btnStop.addEventListener('click', () => {
  if (!activeRequestId) return;
  send({ type: 'cancel', requestId: activeRequestId });
  btnStop.disabled = true;
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

/** True only for the Enter Safari re-dispatches right after IME compositionend. */
let compositionJustEnded = false;

chatInput.addEventListener('compositionend', () => {
  compositionJustEnded = true;
  setTimeout(() => {
    compositionJustEnded = false;
  }, 0);
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  // In-composition Enter (keyCode 229) confirms the IME candidate; preventDefault would cancel it.
  if (e.isComposing || e.keyCode === 229) return;
  // Safari/WebKit then fires a plain Enter after compositionend. Swallow the newline, but do not send.
  if (compositionJustEnded) {
    e.preventDefault();
    return;
  }
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
