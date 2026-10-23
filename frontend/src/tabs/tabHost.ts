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
  private active: string | null = null;

  constructor(
    private readonly strip: HTMLElement,
    private readonly body: HTMLElement,
    private readonly onEmpty: () => void = () => {},
  ) {}

  has(id: string): boolean {
    return this.tabs.has(id);
  }

  get activeId(): string | null {
    return this.active;
  }

  add(opts: TabOptions): void {
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
    this.strip.append(el);
    this.body.append(opts.pane);
    this.tabs.set(opts.id, { opts, el, label });
    this.activate(opts.id);
  }

  activate(id: string): void {
    if (!this.tabs.has(id)) return;
    this.active = id;
    for (const [tid, t] of this.tabs) {
      const on = tid === id;
      t.opts.pane.classList.toggle('active', on);
      t.el.classList.toggle('active', on);
      t.el.setAttribute('aria-selected', String(on));
    }
    this.tabs.get(id)?.opts.onActivate?.();
  }

  mark(id: string, className: string, on = true): void {
    this.tabs.get(id)?.el.classList.toggle(className, on);
  }

  setTitle(id: string, title: string): void {
    const t = this.tabs.get(id);
    if (t) t.label.textContent = title;
  }

  remove(id: string): void {
    const t = this.tabs.get(id);
    if (!t) return;
    t.el.remove();
    t.opts.pane.remove();
    this.tabs.delete(id);
    if (this.active === id) {
      this.active = null;
      const next = [...this.tabs.keys()].at(-1);
      if (next) this.activate(next);
      else this.onEmpty();
    }
  }
}
