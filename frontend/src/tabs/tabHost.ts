/**
 * One tab strip + body shared by terminals and file viewers. Tabs belong to a
 * group (the workspace that opened them); only the current group's tabs show.
 */
export interface TabOptions {
  id: string;
  title: string;
  tooltip?: string;
  kind: string; // css hook: kind-claude, kind-shell, kind-file
  group?: string; // workspace id; tabs without a group always show
  pane: HTMLElement;
  onActivate?: () => void;
  onClose: () => void;
  /** Enables renaming (double-click or F2); resolve false to keep the old name. */
  onRename?: (title: string) => Promise<boolean>;
}

interface Tab {
  opts: TabOptions;
  el: HTMLElement;
  label: HTMLButtonElement;
}

export class TabHost {
  private readonly tabs = new Map<string, Tab>();
  private recent: string[] = []; // most recently used first
  private active: string | null = null;
  private group: string | null = null;

  constructor(
    private readonly strip: HTMLElement,
    private readonly body: HTMLElement,
    /** Called with the active tab id (null when none is shown) after every change. */
    private readonly onChange: (activeId: string | null) => void = () => {},
  ) {}

  has(id: string): boolean {
    return this.tabs.has(id);
  }

  get activeId(): string | null {
    return this.active;
  }

  private visible(t: Tab): boolean {
    // With no workspace selected only ungrouped tabs show.
    return !t.opts.group || t.opts.group === this.group;
  }

  /** Shows only the tabs of a group (workspace) and returns to its last used tab. */
  setGroup(group: string | null): void {
    this.group = group;
    for (const t of this.tabs.values()) t.el.classList.toggle('hidden', !this.visible(t));
    const next = this.recent.find((id) => {
      const t = this.tabs.get(id);
      return t !== undefined && this.visible(t);
    });
    if (next) this.activate(next);
    else this.deactivate();
  }

  private deactivate() {
    this.active = null;
    for (const t of this.tabs.values()) {
      t.opts.pane.classList.remove('active');
      t.el.classList.remove('active');
      t.el.setAttribute('aria-selected', 'false');
    }
    this.onChange(null);
  }

  /** Adds a tab; it becomes active unless `activate` is false and another tab is active. */
  add(opts: TabOptions, { activate = true } = {}): void {
    if (this.tabs.has(opts.id)) {
      if (activate) this.activate(opts.id);
      return;
    }
    const el = document.createElement('div');
    el.className = `term-tab kind-${opts.kind}`;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', 'false');

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'term-tab-label';
    label.textContent = opts.title;
    label.title = opts.onRename ? `${opts.tooltip ?? ''}\n더블클릭(또는 F2)으로 이름 바꾸기`.trim() : (opts.tooltip ?? '');
    label.addEventListener('click', () => this.activate(opts.id));
    if (opts.onRename) {
      label.addEventListener('dblclick', () => this.startRename(opts.id));
      label.addEventListener('keydown', (e) => {
        if (e.key === 'F2') this.startRename(opts.id);
      });
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'term-tab-close';
    close.textContent = '×';
    close.setAttribute('aria-label', `${opts.title} 탭 닫기`);
    close.addEventListener('click', () => opts.onClose());

    el.append(label, close);
    opts.pane.classList.add('tab-pane');
    opts.pane.classList.remove('active');
    this.strip.append(el);
    this.body.append(opts.pane);
    const tab = { opts, el, label };
    this.tabs.set(opts.id, tab);
    el.classList.toggle('hidden', !this.visible(tab));
    if (!this.visible(tab)) return; // opened for another workspace: stays in the background
    if (activate || this.active === null) this.activate(opts.id);
    else this.onChange(this.active);
  }

  /** Inline rename: Enter saves, Escape or blur without change cancels. */
  startRename(id: string): void {
    const t = this.tabs.get(id);
    if (!t?.opts.onRename || t.el.querySelector('input')) return;
    const input = document.createElement('input');
    input.className = 'term-tab-input';
    input.value = t.label.textContent ?? '';
    input.maxLength = 60;
    t.label.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (save: boolean) => {
      // A tab closed while being renamed is not renamed.
      if (done || this.tabs.get(id) !== t) return;
      done = true;
      const name = input.value.trim();
      input.replaceWith(t.label);
      if (save && name && name !== t.label.textContent && (await t.opts.onRename!(name))) {
        t.label.textContent = name;
        t.opts = { ...t.opts, title: name };
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void finish(true);
      if (e.key === 'Escape') void finish(false);
      e.stopPropagation(); // keep keys away from the terminal
    });
    input.addEventListener('blur', () => void finish(true));
  }

  activate(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab || !this.visible(tab)) return;
    this.active = id;
    this.recent = [id, ...this.recent.filter((r) => r !== id)];
    for (const [tid, t] of this.tabs) {
      const on = tid === id;
      t.opts.pane.classList.toggle('active', on);
      t.el.classList.toggle('active', on);
      t.el.setAttribute('aria-selected', String(on));
    }
    tab.opts.onActivate?.();
    this.onChange(id);
  }

  mark(id: string, className: string, on = true): void {
    this.tabs.get(id)?.el.classList.toggle(className, on);
  }

  remove(id: string): void {
    const t = this.tabs.get(id);
    if (!t) return;
    t.el.remove();
    t.opts.pane.remove();
    this.tabs.delete(id);
    this.recent = this.recent.filter((r) => r !== id);
    if (this.active !== id) {
      this.onChange(this.active);
      return;
    }
    this.active = null;
    const next = this.recent.find((r) => {
      const tab = this.tabs.get(r);
      return tab !== undefined && this.visible(tab);
    });
    if (next) this.activate(next);
    else this.deactivate();
  }
}
