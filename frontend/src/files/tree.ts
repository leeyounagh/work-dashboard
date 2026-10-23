import { ListDir } from '../../wailsjs/go/main/App';
import type { files } from '../../wailsjs/go/models';
import type { Workspace } from '../lib/widgets';
import { addOpened, addSeen, baseName, emptyFileState, pathKey, relativeTo, type FileState } from './fileState';

const TOOL_BADGE: Record<string, string> = { Read: 'R', Edit: 'E', MultiEdit: 'E', Write: 'W', NotebookEdit: 'E' };
const badgeFor = (tool: string) => (Object.hasOwn(TOOL_BADGE, tool) ? TOOL_BADGE[tool] : '');

/** Folders bigger than this show the first entries and a count. */
const MAX_ENTRIES = 500;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

const signature = (ws: Workspace | null) => (ws ? `${ws.id}\0${ws.folders.join('\0')}` : '');

/**
 * Left-hand file tree: files Claude opened for you, files it recently touched,
 * and the workspace folders (listed lazily and cached until collapsed).
 */
export class FileTree {
  private workspace: Workspace | null = null;
  private readonly states = new Map<string, FileState>(); // by workspace id
  private readonly expanded = new Set<string>(); // by pathKey
  private readonly listings = new Map<string, files.Entry[] | Error>(); // by pathKey
  private frame = 0;
  private rendering = 0;
  private results: { entries: files.Entry[]; truncated: boolean; query: string } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly openFile: (path: string) => void,
  ) {
    // One delegated listener instead of one per row.
    host.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-path]');
      if (!row?.dataset.path) return;
      if (row.dataset.dir === '1') this.toggle(row.dataset.path);
      else this.openFile(row.dataset.path);
    });
  }

  private state(id: string): FileState {
    return this.states.get(id) ?? emptyFileState();
  }

  /** Shows a workspace; re-renders when it or its folders changed. */
  show(ws: Workspace | null): void {
    if (signature(ws) === signature(this.workspace)) return;
    this.workspace = ws;
    this.listings.clear();
    this.schedule();
  }

  /** Files Claude asked to show via open_files. */
  opened(workspaceId: string, paths: string[]): void {
    this.states.set(workspaceId, addOpened(this.state(workspaceId), paths));
    if (this.workspace?.id === workspaceId) this.schedule();
  }

  /** A file Claude read or edited. */
  seen(workspaceId: string, path: string, tool: string): void {
    this.states.set(workspaceId, addSeen(this.state(workspaceId), path, tool));
    if (this.workspace?.id === workspaceId) this.schedule();
  }

  /** Shows search results instead of the tree; null goes back to the tree. */
  showResults(results: { entries: files.Entry[] | null; truncated: boolean; query: string } | null): void {
    this.results = results ? { ...results, entries: results.entries ?? [] } : null;
    this.schedule();
  }

  /** Drops cached folder listings, e.g. after files changed on disk. */
  refresh(): void {
    this.listings.clear();
    this.schedule();
  }

  private toggle(path: string) {
    const key = pathKey(path);
    if (this.expanded.has(key)) {
      this.expanded.delete(key);
      this.listings.delete(key);
    } else {
      this.expanded.add(key);
    }
    this.schedule();
  }

  /** Coalesces bursts of events (e.g. many hooks) into one render per frame. */
  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      void this.render();
    });
  }

  private fileRow(path: string, badge = ''): HTMLElement {
    const row = node('button', 'tree-file');
    row.type = 'button';
    row.title = path;
    row.dataset.path = path;
    if (badge) row.append(node('span', `badge badge-${badge}`, badge));
    row.append(node('span', 'tree-name', baseName(path)));
    if (this.workspace) {
      row.append(node('span', 'tree-dir', relativeTo(path, this.workspace.folders).replace(/[\\/][^\\/]*$/, '')));
    }
    return row;
  }

  private section(title: string, rows: HTMLElement[], empty: string): HTMLElement {
    const sec = node('section', 'tree-section');
    sec.append(node('h3', 'tree-title', title));
    sec.append(...(rows.length ? rows : [node('p', 'muted small', empty)]));
    return sec;
  }

  /** Loads listings for every expanded folder that is not cached yet, in parallel. */
  private async loadExpanded(dirs: string[]): Promise<void> {
    const missing = dirs.filter((d) => this.expanded.has(pathKey(d)) && !this.listings.has(pathKey(d)));
    await Promise.all(
      missing.map(async (d) => {
        try {
          this.listings.set(pathKey(d), await ListDir(d));
        } catch (err) {
          this.listings.set(pathKey(d), err instanceof Error ? err : new Error(String(err)));
        }
      }),
    );
  }

  private dirRows(path: string, depth: number): HTMLElement[] {
    const listing = this.listings.get(pathKey(path));
    if (listing instanceof Error) return [node('p', 'error small', listing.message)];
    if (!listing) return [node('p', 'muted small', '불러오는 중…')];
    const rows: HTMLElement[] = [];
    for (const e of listing.slice(0, MAX_ENTRIES)) {
      const open = e.dir && this.expanded.has(pathKey(e.path));
      const row = node('button', e.dir ? 'tree-dir-row' : 'tree-file', `${e.dir ? (open ? '▾ ' : '▸ ') : ''}${e.name}`);
      row.type = 'button';
      row.style.paddingLeft = `${12 + depth * 12}px`;
      row.title = e.path;
      row.dataset.path = e.path;
      if (e.dir) row.dataset.dir = '1';
      rows.push(row);
      if (open) rows.push(...this.dirRows(e.path, depth + 1));
    }
    if (listing.length > MAX_ENTRIES) {
      rows.push(node('p', 'muted small', `… 외 ${listing.length - MAX_ENTRIES}개`));
    }
    return rows;
  }

  /** Expanded folders under the workspace roots, breadth-first. */
  private expandedDirs(): string[] {
    const out: string[] = [];
    const visit = (dir: string) => {
      if (!this.expanded.has(pathKey(dir))) return;
      out.push(dir);
      const listing = this.listings.get(pathKey(dir));
      if (Array.isArray(listing)) for (const e of listing) if (e.dir) visit(e.path);
    };
    for (const f of this.workspace?.folders ?? []) visit(f);
    return out;
  }

  private async render(): Promise<void> {
    const ws = this.workspace;
    const ticket = ++this.rendering;
    if (!ws?.id) {
      this.host.replaceChildren(node('p', 'muted', '워크스페이스를 선택하면 파일이 보입니다.'));
      return;
    }
    if (this.results) {
      const { entries, truncated, query } = this.results;
      const rows = entries.map((e) => this.fileRow(e.path));
      const note = truncated ? [node('p', 'muted small', `결과가 많아 ${entries.length}개까지만 보여 줍니다. 더 구체적으로 검색하세요.`)] : [];
      this.host.replaceChildren(this.section(`「${query}」 검색 결과`, [...rows, ...note], '일치하는 파일이 없습니다.'));
      return;
    }
    // Load newly expanded folders level by level (children appear once parents load).
    for (let depth = 0; depth < 32; depth++) {
      const before = this.listings.size;
      await this.loadExpanded(this.expandedDirs());
      if (ticket !== this.rendering) return; // a newer render started
      if (this.listings.size === before) break;
    }

    const st = this.state(ws.id);
    const folderRows: HTMLElement[] = [];
    for (const folder of ws.folders) {
      const open = this.expanded.has(pathKey(folder));
      const head = node('button', 'tree-dir-row tree-root', `${open ? '▾' : '▸'} ${baseName(folder)}`);
      head.type = 'button';
      head.title = folder;
      head.dataset.path = folder;
      head.dataset.dir = '1';
      folderRows.push(head);
      if (open) folderRows.push(...this.dirRows(folder, 1));
    }
    this.host.replaceChildren(
      this.section(
        '열린 파일',
        st.opened.map((p) => this.fileRow(p)),
        'Claude 에게 「○○ 코드 열어줘」 라고 하면 여기에 나옵니다.',
      ),
      this.section(
        '최근 본 파일',
        st.seen.map((e) => this.fileRow(e.path, badgeFor(e.tool))),
        'Claude 가 읽거나 고친 파일이 쌓입니다.',
      ),
      this.section('폴더', folderRows, '폴더가 없습니다.'),
    );
  }
}
