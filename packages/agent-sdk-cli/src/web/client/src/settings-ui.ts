export type SettingsCategory = 'model' | 'behavior' | 'paths';

export interface SettingsUi {
  select(category: SettingsCategory): void;
  getSelected(): SettingsCategory;
}

const CATEGORIES: SettingsCategory[] = ['model', 'behavior', 'paths'];

function isSettingsCategory(value: string): value is SettingsCategory {
  return CATEGORIES.includes(value as SettingsCategory);
}

export function initSettingsUi(opts: {
  nav: HTMLElement;
  panes: HTMLElement[];
}): SettingsUi {
  const tabs = Array.from(opts.nav.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  let selected: SettingsCategory = 'model';

  function select(category: SettingsCategory, focusTab = false): void {
    selected = category;
    for (const tab of tabs) {
      const id = tab.id.replace('settings-tab-', '');
      const active = isSettingsCategory(id) && id === category;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
      if (active && focusTab) tab.focus();
    }
    for (const pane of opts.panes) {
      const id = pane.id.replace('settings-pane-', '');
      pane.hidden = !(isSettingsCategory(id) && id === category);
    }
  }

  opts.nav.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const tab = target.closest<HTMLButtonElement>('[role="tab"]');
    if (!tab || !opts.nav.contains(tab)) return;
    const id = tab.id.replace('settings-tab-', '');
    if (isSettingsCategory(id)) select(id);
  });

  const navKeys = new Set(['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End']);

  opts.nav.addEventListener('keydown', (ev) => {
    if (!navKeys.has(ev.key)) return;
    const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    if (current < 0) return;
    ev.preventDefault();
    let next = current;
    if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = tabs.length - 1;
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else next = (current - 1 + tabs.length) % tabs.length;
    const id = tabs[next]?.id.replace('settings-tab-', '');
    if (id && isSettingsCategory(id)) select(id, true);
  });

  select(selected);

  return {
    select,
    getSelected: () => selected
  };
}
