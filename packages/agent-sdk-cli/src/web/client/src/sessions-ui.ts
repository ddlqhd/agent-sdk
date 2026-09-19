import type { SessionListItem } from '../../shared/ws-protocol.js';
import { formatRelativeTime, shortId } from './util.js';

export interface SessionsUi {
  render(sessions: SessionListItem[], currentId?: string): void;
  setCurrent(id?: string): void;
}

export function initSessionsUi(opts: {
  listEl: HTMLUListElement;
  searchEl: HTMLInputElement;
  onResume: (id: string) => void;
  onFork: (id: string) => void;
}): SessionsUi {
  let cached: SessionListItem[] = [];
  let currentId: string | undefined;
  let filter = '';

  function paint(): void {
    const q = filter.trim().toLowerCase();
    const items = q ? cached.filter((s) => s.id.toLowerCase().includes(q)) : cached;
    opts.listEl.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'session-list-empty';
      empty.textContent = cached.length === 0 ? '暂无会话' : '无匹配会话';
      opts.listEl.appendChild(empty);
      return;
    }
    for (const s of items) {
      const li = document.createElement('li');
      li.className = 'session-row';
      if (s.id === currentId) li.classList.add('active');
      li.tabIndex = 0;
      li.title = s.id;

      const dot = document.createElement('span');
      dot.className = 'session-dot';
      dot.setAttribute('aria-hidden', 'true');

      const main = document.createElement('div');
      main.className = 'session-row-main';
      const idEl = document.createElement('div');
      idEl.className = 'session-row-id';
      idEl.textContent = shortId(s.id);
      const meta = document.createElement('div');
      meta.className = 'session-row-meta';
      meta.textContent = `${formatRelativeTime(s.updatedAt)} · ${s.messageCount} 条`;
      main.appendChild(idEl);
      main.appendChild(meta);

      const fork = document.createElement('button');
      fork.type = 'button';
      fork.className = 'btn btn-ghost btn-sm session-row-fork';
      fork.textContent = '分支';
      fork.addEventListener('click', (ev) => {
        ev.stopPropagation();
        opts.onFork(s.id);
      });

      li.appendChild(dot);
      li.appendChild(main);
      li.appendChild(fork);
      li.addEventListener('click', () => opts.onResume(s.id));
      li.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          opts.onResume(s.id);
        }
      });
      opts.listEl.appendChild(li);
    }
  }

  opts.searchEl.addEventListener('input', () => {
    filter = opts.searchEl.value;
    paint();
  });

  return {
    render(sessions, id) {
      cached = sessions;
      if (id !== undefined) currentId = id;
      paint();
    },
    setCurrent(id) {
      currentId = id;
      paint();
    }
  };
}
