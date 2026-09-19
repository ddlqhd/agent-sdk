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

export function initChatUi(opts: { logEl: HTMLDivElement; heroEl: HTMLElement }): ChatUi {
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

  function scroller(): HTMLElement {
    return logEl.closest('.chat-scroll') ?? logEl.parentElement ?? logEl;
  }

  function isNearBottom(thresholdPx = CHAT_LOG_NEAR_BOTTOM_PX): boolean {
    const { scrollHeight, scrollTop, clientHeight } = scroller();
    return scrollHeight - scrollTop - clientHeight <= thresholdPx;
  }

  function scrollIfPinned(wasNearBottom: boolean): void {
    const el = scroller();
    if (wasNearBottom) {
      el.scrollTop = el.scrollHeight;
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
    const el = scroller();
    el.scrollTop = el.scrollHeight;
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
    const el = scroller();
    el.scrollTop = el.scrollHeight;
  }

  function setToolSection(
    card: HTMLElement,
    kind: 'args' | 'result',
    label: string,
    text: string
  ): void {
    const body = card.querySelector<HTMLElement>('.tool-inline-body');
    if (!body) return;
    let section = body.querySelector<HTMLElement>(`.tool-inline-section[data-kind="${kind}"]`);
    if (!section) {
      section = document.createElement('div');
      section.className = 'tool-inline-section';
      section.dataset.kind = kind;
      const labelEl = document.createElement('div');
      labelEl.className = 'tool-inline-section-label';
      const pre = document.createElement('pre');
      pre.className = 'tool-inline-pre';
      section.appendChild(labelEl);
      section.appendChild(pre);
      body.appendChild(section);
    }
    const labelEl = section.querySelector('.tool-inline-section-label');
    const pre = section.querySelector('.tool-inline-pre');
    if (labelEl) labelEl.textContent = label;
    if (pre) pre.textContent = truncate(text) || '{}';
    section.hidden = false;
  }

  function upsertTool(id: string, name: string, status: 'call' | 'result' | 'error', body: string): void {
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
      nameEl.textContent = name.trim() || id || '(unknown tool)';
      const previewEl = document.createElement('span');
      previewEl.className = 'tool-inline-preview';
      const statusEl = document.createElement('span');
      statusEl.className = 'tool-inline-status';
      summary.appendChild(nameEl);
      summary.appendChild(previewEl);
      summary.appendChild(statusEl);
      const bodyEl = document.createElement('div');
      bodyEl.className = 'tool-inline-body';
      bodyEl.hidden = true;
      summary.addEventListener('click', () => {
        bodyEl.hidden = !bodyEl.hidden;
      });
      card.appendChild(summary);
      card.appendChild(bodyEl);
      logEl.appendChild(card);
      toolCards.set(id, card);
      syncHero();
    } else if (name.trim()) {
      const nameEl = card.querySelector('.tool-inline-name');
      if (nameEl && (!nameEl.textContent || nameEl.textContent === id || nameEl.textContent === '(unknown tool)')) {
        nameEl.textContent = name.trim();
      }
    }
    const statusEl = card.querySelector('.tool-inline-status');
    if (statusEl) {
      statusEl.textContent = status === 'call' ? '调用中' : status === 'result' ? '完成' : '失败';
    }
    if (status === 'call') {
      setToolSection(card, 'args', '参数', body);
      const previewEl = card.querySelector('.tool-inline-preview');
      if (previewEl) {
        const line = body.replace(/\s+/g, ' ').trim();
        previewEl.textContent = line.length <= 96 ? line : `${line.slice(0, 96)}…`;
      }
    } else {
      setToolSection(card, 'result', status === 'error' ? '错误' : '结果', body);
    }
    card.classList.toggle('is-error', status === 'error');
    card.classList.toggle('is-ok', status === 'result');
    scrollIfPinned(pinned);
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
    upsertTool,
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
        if (m.role === 'tool') {
          if (m.arguments !== undefined) {
            upsertTool(m.id, m.name, 'call', formatToolArguments(m.arguments) || '{}');
          }
          if (m.result !== undefined) {
            upsertTool(m.id, m.name, m.status, m.result);
          } else if (m.arguments === undefined) {
            upsertTool(m.id, m.name, m.status, '');
          }
          continue;
        }
        if (m.role === 'user') appendUser(m.text);
        else appendAssistant(m.text);
      }
      syncHero();
    },
    isNearBottom
  };
}
