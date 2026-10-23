import { ListDir } from '../../wailsjs/go/main/App';
import type { Workspace } from '../lib/widgets';
import { addOpened, addSeen, baseName, emptyFileState, relativeTo, type FileState } from './fileState';

const TOOL_BADGE: Partial<Record<string, string>> = { Read: 'R', Edit: 'E', MultiEdit: 'E', Write: 'W', NotebookEdit: 'E' };

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

/**
 * Left-hand file tree: files Claude opened for you, files it recently touched,
 * and the workspace folders (loaded lazily).
 */
export class FileTree {
  private workspace: Workspace | null = null;
  private readonly states = new Map<string, FileState>(); // by workspace id
  private readonly expanded = new Set<string>();

  constructor(
    private readonly host: HTMLElement,
    private readonly openFile: (path: string) => void,
    private readonly onError: (message: string) => void,
  ) {}

  private state(id: string): FileState {
    return this.states.get(id) ?? emptyFileState();
  }

  show(ws: Workspace | null): void {
    this.workspace = ws;
    void this.render();
  }

  /** Files Claude asked to show via open_files. */
  opened(workspaceId: string, paths: string[]): void {
    this.states.set(workspaceId, addOpened(this.state(workspaceId), paths));
    if (this.workspace?.id === workspaceId) void this.render();
  }

  /** A file Claude read or edited. */
  seen(workspaceId: string, path: string, tool: string): void {
    this.states.set(workspaceId, addSeen(this.state(workspaceId), path, tool));
    if (this.workspace?.id === workspaceId) void this.render();
  }

  private fileRow(path: string, badge = ''): HTMLElement {
    const ws = this.workspace;
    const row = node('button', 'tree-file');
    row.type = 'button';
    row.title = path;
    if (badge) row.append(node('span', `badge badge-${badge}`, badge));
    row.append(node('span', 'tree-name', baseName(path)));
    if (ws) row.append(node('span', 'tree-dir', relativeTo(path, ws.folders).replace(/[\\/][^\\/]*$/, '')));
    row.addEventListener('click', () => this.openFile(path));
    return row;
  }

  private section(title: string, rows: HTMLElement[], empty: string): HTMLElement {
    const sec = node('section', 'tree-section');
    sec.append(node('h3', 'tree-title', title));
    sec.append(...(rows.length ? rows : [node('p', 'muted small', empty)]));
    return sec;
  }

  private async dirRows(path: string, depth: number): Promise<HTMLElement[]> {
    let entries;
    try {
      entries = await ListDir(path);
    } catch (err) {
      return [node('p', 'error small', String(err))];
    }
    const rows: HTMLElement[] = [];
    for (const e of entries) {
      const row = node('button', e.dir ? 'tree-dir-row' : 'tree-file');
      row.type = 'button';
      row.style.paddingLeft = `${12 + depth * 12}px`;
      row.title = e.path;
      const open = this.expanded.has(e.path);
      row.textContent = `${e.dir ? (open ? '▾ ' : '▸ ') : ''}${e.name}`;
      row.addEventListener('click', () => {
        if (!e.dir) {
          this.openFile(e.path);
          return;
        }
        if (open) this.expanded.delete(e.path);
        else this.expanded.add(e.path);
        void this.render();
      });
      rows.push(row);
      if (e.dir && open) rows.push(...(await this.dirRows(e.path, depth + 1)));
    }
    return rows;
  }

  private rendering = 0;

  private async render(): Promise<void> {
    const ws = this.workspace;
    const ticket = ++this.rendering;
    if (!ws?.id) {
      this.host.replaceChildren(node('p', 'muted', '워크스페이스를 선택하면 파일이 보입니다.'));
      return;
    }
    const st = this.state(ws.id);
    const folderRows: HTMLElement[] = [];
    for (const folder of ws.folders) {
      const open = this.expanded.has(folder);
      const head = node('button', 'tree-dir-row tree-root', `${open ? '▾' : '▸'} ${baseName(folder)}`);
      head.type = 'button';
      head.title = folder;
      head.addEventListener('click', () => {
        if (open) this.expanded.delete(folder);
        else this.expanded.add(folder);
        void this.render();
      });
      folderRows.push(head);
      if (open) folderRows.push(...(await this.dirRows(folder, 1)));
    }
    // A newer render started while we awaited directory listings.
    if (ticket !== this.rendering) return;
    try {
      this.host.replaceChildren(
        this.section(
          '열린 파일',
          st.opened.map((p) => this.fileRow(p)),
          'Claude 에게 「○○ 코드 열어줘」 라고 하면 여기에 나옵니다.',
        ),
        this.section(
          '최근 본 파일',
          st.seen.map((e) => this.fileRow(e.path, TOOL_BADGE[e.tool] ?? '')),
          'Claude 가 읽거나 고친 파일이 쌓입니다.',
        ),
        this.section('폴더', folderRows, '폴더가 없습니다.'),
      );
    } catch (err) {
      this.onError(String(err));
    }
  }
}
