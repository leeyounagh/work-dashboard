import { baseName, pathKey } from '../files/fileState';
import { parseDiff, touch, type ChangedFile, type DiffLine, type ParsedDiff } from './changeState';

const COLLAPSED_KEY = 'work-dashboard.changesCollapsed';
/** Edits often come in bursts; one git diff per file per burst is enough. */
const REFRESH_DELAY_MS = 300;
/** Long diffs are cut so a generated file cannot freeze the page. */
const MAX_LINES = 1000;

type DiffState = { status: 'loading' } | { status: 'ok'; raw: string; diff: ParsedDiff } | { status: 'error'; message: string };

export interface ChangesPanelDeps {
  /** git diff of one file against HEAD ("" when unchanged). */
  loadDiff: (path: string) => Promise<string>;
  /** Opens the file in the viewer. */
  openFile: (path: string) => void;
  /** Called after the panel appears, collapses or expands (the terminal refits). */
  onLayout: () => void;
}

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveCollapsed(on: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, on ? '1' : '0');
  } catch {
    // Not fatal: the choice just isn't remembered.
  }
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text) el.textContent = text;
  return el;
}

/** The parent folder's name, to tell same-named files apart. */
function parentName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

/**
 * The right side of a Claude terminal: the files this session changed, each
 * with its diff against the last commit. It stays hidden until the first edit.
 */
export class ChangesPanel {
  readonly el: HTMLElement;
  private files: ChangedFile[] = [];
  private readonly diffs = new Map<string, DiffState>();
  private readonly open = new Set<string>(); // expanded files, by pathKey
  private readonly pinned = new Set<string>(); // files the user expanded themselves
  private readonly timers = new Map<string, number>();
  private readonly loads = new Map<string, number>(); // latest load per file; older results are dropped
  private queue: Promise<void> = Promise.resolve(); // one git diff at a time
  private renderPending = false;
  private collapsed = loadCollapsed();
  private disposed = false;
  private readonly header: HTMLElement;
  private readonly list: HTMLElement;

  constructor(private readonly deps: ChangesPanelDeps) {
    this.el = node('aside', 'changes hidden');
    this.el.setAttribute('aria-label', '바뀐 파일');
    this.header = node('header', 'changes-head');
    this.list = node('div', 'changes-list');
    this.el.append(this.header, this.list);
    this.applyCollapsed();
  }

  /** A file this session wrote: list it first and (re)load its diff. */
  touched(path: string, tool: string): void {
    if (this.disposed) return;
    const first = this.files.length === 0;
    const key = pathKey(path);
    const known = this.diffs.has(key);
    this.files = touch(this.files, path, tool);
    if (!known) {
      // A new file on the list is the one to look at; the others fold away
      // unless the user opened them (keeps long sessions light to draw).
      for (const k of [...this.open]) if (!this.pinned.has(k)) this.open.delete(k);
      this.open.add(key);
    }
    if (first) {
      this.el.classList.remove('hidden');
      this.deps.onLayout();
    }
    this.schedule(path);
  }

  /** Reloads every diff, e.g. when Claude stops (a formatter may have run). */
  refreshAll(): void {
    for (const f of this.files) this.schedule(f.path);
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers.values()) window.clearTimeout(t);
    this.timers.clear();
  }

  private schedule(path: string) {
    const key = pathKey(path);
    window.clearTimeout(this.timers.get(key));
    if (!this.diffs.has(key)) this.diffs.set(key, { status: 'loading' });
    this.render();
    this.timers.set(
      key,
      window.setTimeout(() => {
        this.timers.delete(key);
        const seq = (this.loads.get(key) ?? 0) + 1;
        this.loads.set(key, seq);
        this.queue = this.queue.then(() => this.load(path, seq));
      }, REFRESH_DELAY_MS),
    );
  }

  private async load(path: string, seq: number) {
    const key = pathKey(path);
    if (this.disposed || this.loads.get(key) !== seq) return; // a newer load is coming
    let next: DiffState;
    try {
      const raw = await this.deps.loadDiff(path);
      next = { status: 'ok', raw, diff: parseDiff(raw) };
    } catch (err) {
      next = { status: 'error', message: String(err) };
    }
    if (this.disposed || this.loads.get(key) !== seq) return;
    const prev = this.diffs.get(key);
    this.diffs.set(key, next);
    // Most reloads (each Stop) find nothing new: skip redrawing then.
    if (prev?.status === 'ok' && next.status === 'ok' && prev.raw === next.raw) return;
    this.render();
  }

  private toggleCollapsed() {
    this.collapsed = !this.collapsed;
    saveCollapsed(this.collapsed);
    this.applyCollapsed();
    this.deps.onLayout();
  }

  private applyCollapsed() {
    this.el.classList.toggle('collapsed', this.collapsed);
    this.render();
  }

  private totals(): { added: number; removed: number } {
    let added = 0;
    let removed = 0;
    for (const f of this.files) {
      const d = this.diffs.get(pathKey(f.path));
      if (d?.status === 'ok') {
        added += d.diff.added;
        removed += d.diff.removed;
      }
    }
    return { added, removed };
  }

  /** Draws once for a burst of changes. */
  private render() {
    if (this.renderPending) return;
    this.renderPending = true;
    queueMicrotask(() => {
      this.renderPending = false;
      this.draw();
    });
  }

  private draw() {
    if (this.disposed) return;
    const { added, removed } = this.totals();
    const toggle = node('button', 'icon changes-toggle', this.collapsed ? '◀' : '▶');
    toggle.type = 'button';
    toggle.title = this.collapsed ? '바뀐 파일 펼치기' : '바뀐 파일 접기';
    toggle.setAttribute('aria-expanded', String(!this.collapsed));
    toggle.addEventListener('click', () => this.toggleCollapsed());
    const title = node('span', 'changes-title', `바뀐 파일 ${this.files.length}`);
    const stats = node('span', 'changes-stats');
    stats.append(node('span', 'diff-add', `+${added}`), node('span', 'diff-del', `−${removed}`));
    const children: HTMLElement[] = [toggle, title, stats];
    if (!this.collapsed) {
      const reload = node('button', 'icon changes-reload', '↻');
      reload.type = 'button';
      reload.title = '모두 다시 불러오기';
      reload.addEventListener('click', () => this.refreshAll());
      children.push(reload);
    }
    this.header.replaceChildren(...children);
    // Re-rendering must not jump the list back to the top while reading.
    const scroll = this.list.scrollTop;
    this.list.replaceChildren(...(this.collapsed ? [] : this.files.map((f) => this.renderFile(f))));
    this.list.scrollTop = scroll;
  }

  private renderFile(f: ChangedFile): HTMLElement {
    const key = pathKey(f.path);
    const state = this.diffs.get(key) ?? { status: 'loading' };
    const expanded = this.open.has(key);
    const item = node('section', 'change-file');
    const row = node('div', 'change-row');
    const caret = node('button', 'icon change-caret', expanded ? '▾' : '▸');
    caret.type = 'button';
    caret.setAttribute('aria-expanded', String(expanded));
    caret.setAttribute('aria-label', `${baseName(f.path)} 변경 ${expanded ? '접기' : '펼치기'}`);
    caret.addEventListener('click', () => {
      if (expanded) {
        this.open.delete(key);
        this.pinned.delete(key);
      } else {
        this.open.add(key);
        this.pinned.add(key);
      }
      this.render();
    });
    const name = node('button', 'icon change-name', baseName(f.path));
    name.type = 'button';
    name.title = `${f.path}\n누르면 파일을 엽니다`;
    name.addEventListener('click', () => this.deps.openFile(f.path));
    row.append(caret, name, node('span', 'change-dir', parentName(f.path)));
    if (state.status === 'ok') {
      if (state.diff.isNew) row.append(node('span', 'badge badge-new', '새 파일'));
      row.append(node('span', 'diff-add', `+${state.diff.added}`), node('span', 'diff-del', `−${state.diff.removed}`));
    }
    item.append(row);
    if (expanded) item.append(this.renderBody(state));
    return item;
  }

  private renderBody(state: DiffState): HTMLElement {
    if (state.status === 'loading') return node('p', 'muted change-note', '불러오는 중…');
    if (state.status === 'error') return node('p', 'error change-note', `변경 내용을 가져오지 못했습니다: ${state.message}`);
    const { diff } = state;
    if (diff.binary) return node('p', 'muted change-note', '바이너리 파일이라 내용을 보여 주지 않습니다');
    if (diff.lines.length === 0) {
      return node('p', 'muted change-note', diff.isNew ? '빈 새 파일입니다' : '마지막 커밋과 같습니다 (커밋했거나 되돌림)');
    }
    const body = node('div', 'change-diff');
    body.append(...diff.lines.slice(0, MAX_LINES).map(renderLine));
    if (diff.lines.length > MAX_LINES) {
      body.append(node('div', 'diff-line diff-note', `… ${diff.lines.length - MAX_LINES}줄 더 있음 (파일을 열어 「변경 보기」)`));
    }
    return body;
  }
}

function renderLine(l: DiffLine): HTMLElement {
  const row = node('div', `diff-line diff-${l.kind}`);
  if (l.kind === 'hunk' || l.kind === 'note') {
    row.textContent = l.text;
    return row;
  }
  const sign = l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' ';
  row.append(
    node('span', 'diff-no', l.oldNo === undefined ? '' : String(l.oldNo)),
    node('span', 'diff-no', l.newNo === undefined ? '' : String(l.newNo)),
    node('span', 'diff-sign', sign),
    node('span', 'diff-text', l.text),
  );
  return row;
}
