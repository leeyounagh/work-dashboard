import type { Where } from '../lib/sortable';
import { mergeOrder, type TabOrderStore } from './tabOrder';

/** A private drag type, so dropping a tab into a terminal or text field inserts nothing. */
const DRAG_TYPE = 'application/x-work-dashboard-tab';

/**
 * One tab strip + body shared by terminals and file viewers. Tabs belong to a
 * group (the workspace that opened them); only the current group's tabs show.
 */
export interface TabOptions {
  id: string;
  /** A key that survives restarts; a reordered tab with one opens in its old place. */
  sortKey?: string;
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
  private dragging: string | null = null;

  constructor(
    private readonly strip: HTMLElement,
    private readonly body: HTMLElement,
    /** Called with the active tab id (null when none is shown) after every change. */
    private readonly onChange: (activeId: string | null) => void = () => {},
    private readonly orderStore?: TabOrderStore,
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
    this.makeDraggable(el, opts.id);
    opts.pane.classList.add('tab-pane');
    opts.pane.classList.remove('active');
    this.placeNew(el, opts.sortKey);
    this.body.append(opts.pane);
    const tab = { opts, el, label };
    this.tabs.set(opts.id, tab);
    el.classList.toggle('hidden', !this.visible(tab));
    if (!this.visible(tab)) return; // opened for another workspace: stays in the background
    if (activate || this.active === null) this.activate(opts.id);
    else this.onChange(this.active);
  }

  /** Moves a tab before or after another in the strip; unknown or identical ids do nothing. */
  move(from: string, to: string, where: Where): void {
    const a = this.tabs.get(from);
    const b = this.tabs.get(to);
    if (!a || !b || a === b) return;
    b.el.insertAdjacentElement(where === 'before' ? 'beforebegin' : 'afterend', a.el);
    this.saveOrder();
  }

  /** A new tab goes at the end, or before the first open tab it was before last time. */
  private placeNew(el: HTMLElement, key: string | undefined) {
    const saved = key && this.orderStore ? this.orderStore.load() : [];
    const rank = key ? saved.indexOf(key) : -1;
    const keys = this.keysByEl();
    const next =
      rank < 0
        ? undefined
        : [...this.strip.children].find((c) => {
            const k = keys.get(c);
            return k !== undefined && saved.indexOf(k) > rank;
          });
    if (next) this.strip.insertBefore(el, next);
    else this.strip.append(el);
  }

  private keysByEl(): Map<Element, string | undefined> {
    return new Map([...this.tabs.values()].map((t) => [t.el, t.opts.sortKey]));
  }

  private saveOrder() {
    if (!this.orderStore) return;
    const keys = this.keysByEl();
    const current = [...this.strip.children].flatMap((el) => keys.get(el) ?? []);
    this.orderStore.save(mergeOrder(current, this.orderStore.load()));
  }

  /** Drag a tab sideways onto another to reorder the strip. */
  private makeDraggable(el: HTMLElement, id: string) {
    el.draggable = true;
    const clear = () => el.classList.remove('drop-before', 'drop-after');
    el.addEventListener('dragstart', (e) => {
      // Renaming: let the mouse select text in the input instead.
      if (el.querySelector('input')) {
        e.preventDefault();
        return;
      }
      this.dragging = id;
      el.classList.add('dragging');
      e.dataTransfer?.setData(DRAG_TYPE, id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      this.dragging = null;
      for (const t of this.tabs.values()) t.el.classList.remove('dragging', 'drop-before', 'drop-after');
    });
    // Only a tab of this strip being dragged; other drags (text, files) pass through.
    const from = () => (this.dragging !== null && this.dragging !== id && this.tabs.has(this.dragging) ? this.dragging : null);
    const side = (e: DragEvent): Where => {
      const r = el.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
    };
    el.addEventListener('dragover', (e) => {
      if (!from()) return;
      e.preventDefault();
      const before = side(e) === 'before';
      el.classList.toggle('drop-before', before);
      el.classList.toggle('drop-after', !before);
    });
    el.addEventListener('dragleave', clear);
    el.addEventListener('drop', (e) => {
      const f = from();
      clear();
      if (!f) return;
      e.preventDefault();
      // From the pointer, not the marks: dragleave clears them between the tab's children.
      this.move(f, id, side(e));
    });
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
    if (this.dragging === id) this.dragging = null;
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
