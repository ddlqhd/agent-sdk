import type { ChatHistoryItem } from '../../shared/message-text.js';

const MAX_TOOL_SNIPPET_CHARS = 14_000;
const CHAT_LOG_NEAR_BOTTOM_PX = 48;

export interface ChatUi {
  appendUser(text: string): void;
  appendAssistant(text: string): void;
  appendThinkingDelta(chunk: string): void;
  endThinking(): void;
  appendAssistantDelta(chunk: string): void;
  finishStreaming(): void;
  upsertTool(id: string, name: string, status: 'call' | 'result' | 'error', body: string): void;
  clear(): void;
  renderHistory(messages: ChatHistoryItem[]): void;
  isNearBottom(): boolean;
}

function truncate(text: string, max = MAX_TOOL_SNIPPET_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n… (truncated, ${text.length} chars total)`;
}

export function formatToolArguments(args: unknown): string {
  if (args === undefined) return '';
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export function truncateForChatSnippet(text: string, max = MAX_TOOL_SNIPPET_CHARS): string {
  return truncate(text, max);
}

export function initChatUi(opts: { logEl: HTMLDivElement; heroEl: HTMLElement; onToolFocus: () => void }): ChatUi {
  const { logEl, heroEl } = opts;
  let streamingAssistantMsgEl: HTMLDivElement | null = null;
  let streamingAssistantThinkingEl: HTMLPreElement | null = null;
  let streamingThinkingWrap: HTMLDetailsElement | null = null;
  let streamingAssistantBodyEl: HTMLSpanElement | null = null;
  const toolCards = new Map<string, HTMLElement>();

  function syncHero(): void {
    const has = logEl.childElementCount > 0;
    heroEl.hidden = has;
  }

  function isNearBottom(thresholdPx = CHAT_LOG_NEAR_BOTTOM_PX): boolean {
    const { scrollHeight, scrollTop, clientHeight } = logEl.parentElement ?? logEl;
    return scrollHeight - scrollTop - clientHeight <= thresholdPx;
  }

  function scrollIfPinned(wasNearBottom: boolean): void {
    const scroller = logEl.parentElement ?? logEl;
    if (wasNearBottom) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }

  function finishStreaming(): void {
    streamingAssistantMsgEl = null;
    streamingAssistantThinkingEl = null;
    streamingThinkingWrap = null;
    streamingAssistantBodyEl = null;
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
    logEl.appendChild(div);
    streamingAssistantMsgEl = div;
    streamingAssistantThinkingEl = null;
    streamingThinkingWrap = null;
    streamingAssistantBodyEl = null;
    syncHero();
    return div;
  }

  function appendUser(text: string): void {
    const div = document.createElement('div');
    div.className = 'msg user';
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = '用户';
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.textContent = text;
    div.appendChild(role);
    div.appendChild(body);
    logEl.appendChild(div);
    syncHero();
    const scroller = logEl.parentElement ?? logEl;
    scroller.scrollTop = scroller.scrollHeight;
  }

  function appendAssistant(text: string): void {
    const div = document.createElement('div');
    div.className = 'msg assistant';
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = '助手';
    const body = document.createElement('span');
    body.className = 'msg-body';
    body.textContent = text;
    div.appendChild(role);
    div.appendChild(body);
    logEl.appendChild(div);
    syncHero();
    const scroller = logEl.parentElement ?? logEl;
    scroller.scrollTop = scroller.scrollHeight;
  }

  return {
    appendUser,
    appendAssistant,
    appendThinkingDelta(chunk) {
      const pinned = isNearBottom();
      const msg = ensureStreamingAssistantMsg();
      if (!streamingAssistantThinkingEl) {
        const wrap = document.createElement('details');
        wrap.className = 'msg-thinking-wrap';
        wrap.open = true;
        const summary = document.createElement('summary');
        summary.textContent = '思考';
        const pre = document.createElement('pre');
        pre.className = 'msg-thinking';
        wrap.appendChild(summary);
        wrap.appendChild(pre);
        msg.appendChild(wrap);
        streamingThinkingWrap = wrap;
        streamingAssistantThinkingEl = pre;
      }
      streamingAssistantThinkingEl.textContent += chunk;
      scrollIfPinned(pinned);
    },
    endThinking() {
      if (streamingThinkingWrap) {
        streamingThinkingWrap.open = false;
      }
      streamingAssistantThinkingEl = null;
      streamingThinkingWrap = null;
    },
    appendAssistantDelta(chunk) {
      const pinned = isNearBottom();
      const msg = ensureStreamingAssistantMsg();
      if (!streamingAssistantBodyEl) {
        const body = document.createElement('span');
        body.className = 'msg-body';
        msg.appendChild(body);
        streamingAssistantBodyEl = body;
      }
      streamingAssistantBodyEl.textContent += chunk;
      scrollIfPinned(pinned);
    },
    finishStreaming,
    upsertTool(id, name, status, body) {
      finishStreaming();
      const pinned = isNearBottom();
      let card = toolCards.get(id);
      if (!card) {
        card = document.createElement('div');
        card.className = 'tool-inline';
        card.dataset.toolId = id;
        const summary = document.createElement('button');
        summary.type = 'button';
        summary.className = 'tool-inline-summary';
        const nameEl = document.createElement('span');
        nameEl.className = 'tool-inline-name';
        nameEl.textContent = name;
        const statusEl = document.createElement('span');
        statusEl.className = 'tool-inline-status';
        summary.appendChild(nameEl);
        summary.appendChild(statusEl);
        const pre = document.createElement('pre');
        pre.className = 'tool-inline-body';
        pre.hidden = true;
        summary.addEventListener('click', () => {
          pre.hidden = !pre.hidden;
          opts.onToolFocus();
        });
        card.appendChild(summary);
        card.appendChild(pre);
        logEl.appendChild(card);
        toolCards.set(id, card);
        syncHero();
      }
      const statusEl = card.querySelector('.tool-inline-status');
      const pre = card.querySelector('.tool-inline-body');
      if (statusEl) {
        statusEl.textContent = status === 'call' ? '调用中' : status === 'result' ? '完成' : '失败';
      }
      if (pre) pre.textContent = truncate(body) || '{}';
      card.classList.toggle('is-error', status === 'error');
      card.classList.toggle('is-ok', status === 'result');
      scrollIfPinned(pinned);
    },
    clear() {
      logEl.innerHTML = '';
      toolCards.clear();
      finishStreaming();
      syncHero();
    },
    renderHistory(messages) {
      logEl.innerHTML = '';
      toolCards.clear();
      finishStreaming();
      for (const m of messages) {
        if (m.role === 'user') appendUser(m.text);
        else appendAssistant(m.text);
      }
      syncHero();
    },
    isNearBottom
  };
}
