const SIDEBAR_KEY = 'agent-studio-sidebar-collapsed';
const DETAILS_KEY = 'agent-studio-details-open';

export interface LayoutApi {
  isDetailsOpen(): boolean;
  openDetails(): void;
  closeDetails(): void;
  toggleDetails(): void;
  openSettings(): void;
  closeSettings(): void;
  isSettingsOpen(): boolean;
  isSidebarCollapsed(): boolean;
  closeCheckpoints(): void;
  openCheckpoints(): void;
  toggleCheckpoints(): void;
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function initLayout(opts: {
  app: HTMLElement;
  details: HTMLElement;
  sidebarToggle: HTMLButtonElement;
  detailsToggle: HTMLButtonElement;
  settingsOpen: HTMLButtonElement;
  settingsClose: HTMLButtonElement;
  settingsOverlay: HTMLElement;
  checkpointBtn: HTMLButtonElement;
  checkpointPopover: HTMLElement;
}): LayoutApi {
  const {
    app,
    details,
    sidebarToggle,
    detailsToggle,
    settingsOpen,
    settingsClose,
    settingsOverlay,
    checkpointBtn,
    checkpointPopover
  } = opts;

  function applySidebar(collapsed: boolean): void {
    app.classList.toggle('sidebar-collapsed', collapsed);
    sidebarToggle.setAttribute('aria-label', collapsed ? '展开侧栏' : '折叠侧栏');
    sidebarToggle.title = collapsed ? '展开侧栏' : '折叠侧栏';
    writeFlag(SIDEBAR_KEY, collapsed);
  }

  function applyDetails(open: boolean): void {
    app.classList.toggle('details-open', open);
    details.hidden = !open;
    detailsToggle.textContent = open ? '关闭详情' : '详情';
    detailsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    writeFlag(DETAILS_KEY, open);
  }

  function setCheckpoints(open: boolean): void {
    checkpointPopover.hidden = !open;
    checkpointBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  applySidebar(readFlag(SIDEBAR_KEY, false));
  applyDetails(readFlag(DETAILS_KEY, false));

  sidebarToggle.addEventListener('click', () => {
    applySidebar(!app.classList.contains('sidebar-collapsed'));
  });

  detailsToggle.addEventListener('click', () => {
    applyDetails(details.hidden);
  });

  settingsOpen.addEventListener('click', () => {
    settingsOverlay.hidden = false;
    settingsClose.focus();
  });

  settingsClose.addEventListener('click', () => {
    settingsOverlay.hidden = true;
  });

  settingsOverlay.addEventListener('click', (ev) => {
    if (ev.target === settingsOverlay) {
      settingsOverlay.hidden = true;
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!settingsOverlay.hidden) {
      settingsOverlay.hidden = true;
      return;
    }
    if (!checkpointPopover.hidden) {
      setCheckpoints(false);
    }
  });

  document.addEventListener('click', (ev) => {
    if (checkpointPopover.hidden) return;
    const t = ev.target;
    if (!(t instanceof Node)) return;
    if (checkpointPopover.contains(t) || checkpointBtn.contains(t)) return;
    setCheckpoints(false);
  });

  return {
    isDetailsOpen: () => !details.hidden,
    openDetails: () => applyDetails(true),
    closeDetails: () => applyDetails(false),
    toggleDetails: () => applyDetails(details.hidden),
    openSettings: () => {
      settingsOverlay.hidden = false;
    },
    closeSettings: () => {
      settingsOverlay.hidden = true;
    },
    isSettingsOpen: () => !settingsOverlay.hidden,
    isSidebarCollapsed: () => app.classList.contains('sidebar-collapsed'),
    closeCheckpoints: () => setCheckpoints(false),
    openCheckpoints: () => setCheckpoints(true),
    toggleCheckpoints: () => setCheckpoints(checkpointPopover.hidden)
  };
}
