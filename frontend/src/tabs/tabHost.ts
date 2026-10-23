/** One tab strip + body shared by terminals and file viewers. */
export interface TabOptions {
  id: string;
  title: string;
  tooltip?: string;
  kind: string; // css hook: kind-claude, kind-shell, kind-file
  pane: HTMLElement;
  onActivate?: () => void;
  onClose: () => void;
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

  constructor(
    private readonly strip: HTMLElement,
    private readonly body: HTMLElement,
    /** Called with the active tab id (null when none are left) after every change. */
    private readonly onChange: (activeId: string | null) => void = () => {},
  ) {}

  has(id: string): boolean {
    return this.tabs.has(id);
  }

  get activeId(): string | null {
    return this.active;
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
    if (opts.tooltip) label.title = opts.tooltip;
    label.addEventListener('click', () => this.activate(opts.id));

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
    this.tabs.set(opts.id, { opts, el, label });
    if (activate || this.active === null) this.activate(opts.id);
    else this.onChange(this.active);
  }

  activate(id: string): void {
    if (!this.tabs.has(id)) return;
    this.active = id;
    this.recent = [id, ...this.recent.filter((r) => r !== id)];
    for (const [tid, t] of this.tabs) {
      const on = tid === id;
      t.opts.pane.classList.toggle('active', on);
      t.el.classList.toggle('active', on);
      t.el.setAttribute('aria-selected', String(on));
    }
    this.tabs.get(id)?.opts.onActivate?.();
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
    const next = this.recent[0];
    if (next) this.activate(next);
    else this.onChange(null);
  }
}
