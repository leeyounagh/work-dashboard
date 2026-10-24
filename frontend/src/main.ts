import './styles/tokens.css';
import './styles/app.css';

import {
  DeleteWorkspace,
  PickFolder,
  AddTodo,
  CustomSprites,
  DeleteTodo,
  SetTodoDone,
  GuideArticle,
  OpenWidgetFile,
  RestorableSessions,
  SearchFiles,
  SaveWorkspace,
  WidgetCatalog,
  Workspaces,
} from '../wailsjs/go/main/App';
import { workspace as models } from '../wailsjs/go/models';
import { orEmpty, type Definition, type Instance, type ListResult, type Workspace } from './lib/widgets';
import { WidgetBoard } from './widgets/board';
import { addFolder, emptyDraft, isDirty, parseTopics, removeFolder } from './lib/workspaceDraft';
import { applyOrder, moveBy } from './lib/sortable';

const WS_ORDER_KEY = 'work-dashboard.workspaceOrder';

/** Per-viewer order of the workspace list. */
function loadWorkspaceOrder(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(WS_ORDER_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveWorkspaceOrder(ids: string[]) {
  try {
    localStorage.setItem(WS_ORDER_KEY, JSON.stringify(ids));
  } catch {
    // Not fatal: the order just isn't remembered.
  }
}
import { BrowserOpenURL, EventsOn } from '../wailsjs/runtime/runtime';
import { FileTree } from './files/tree';
import { FileViewer } from './files/viewer';
import { Office } from './office/office';
import { guardZoomKeys } from './layout/zoomKeys';
import { currentZoom, loadZoom, setZoom, stepZoom } from './layout/zoom';
import { markNewWorkspace } from './widgets/onboarding';
import type { TodoItem } from './widgets/todo';
import { useCustomSheets } from './office/sprites';
import { mountSplitters } from './layout/splitters';
import { TabHost } from './tabs/tabHost';
import { TerminalPanel, type TerminalKind } from './terminal/panel';
import { renderSidebar, type SidebarHandlers, type SidebarState } from './workspaces/sidebar';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} is missing from index.html`);
  return node as T;
}

interface AgentEvent {
  termId: string;
  event: string;
  tool?: string;
  message?: string;
  progress?: { done: number; total: number; current?: string } | null;
}

/**
 * The pixel office: one character per terminal, animated by Claude hooks.
 * Clicking a character brings its terminal tab to the front.
 */
function startOffice(
  panel: TerminalPanel,
  tabs: TabHost,
  current: () => Workspace | null,
): { stop: () => void; refresh: () => void } | undefined {
  let office: Office;
  try {
    office = new Office(
      byId<HTMLCanvasElement>('floor'),
      (termId) => tabs.activate(termId),
      () => {
        // A blog or article for the selected workspace's technologies.
        GuideArticle(current()?.id ?? '')
          .then((a) => {
            toast(`가이드: ${a.tech} — 「${a.name}」 를 엽니다`);
            BrowserOpenURL(a.url);
          })
          .catch((err) => toast(`읽을거리를 고르지 못했습니다: ${String(err)}`));
      },
    );
  } catch (err) {
    // The office is decorative; the rest of the dashboard should still load.
    console.error('office failed to start', err);
    return undefined;
  }
  // Every terminal keeps a character; only the selected workspace's are shown.
  const refresh = () => {
    const ws = current();
    office.sync(
      panel.list().map(({ id, title, kind, alive, workspaceId }) => ({
        id,
        title,
        kind,
        alive,
        workspaceId,
        workspace: ws && workspaceId === ws.id ? ws.name : '',
      })),
      ws?.id ?? null,
    );
  };
  panel.onChange(refresh);
  panel.onInterrupt((termId) => office.event(termId, { event: 'Interrupt' }));
  // The user's own characters (~/.work-dashboard/characters), if any;
  // guide.png there is the office guide.
  CustomSprites()
    .then((sprites) => {
      if (sprites?.characters?.length || sprites?.guide) {
        useCustomSheets(sprites.characters ?? [], sprites.guide);
        office.reloadArt();
      }
    })
    .catch(() => {});
  const off = EventsOn('agent:event', (ev: AgentEvent) => office.event(ev.termId, ev));
  return {
    refresh,
    stop: () => {
      off();
      office.destroy();
    },
  };
}

let toastTimer = 0;

/** Shows a transient message at the bottom of the window. */
function toast(message: string) {
  const host = byId('toast');
  host.textContent = message;
  host.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => host.classList.remove('show'), 5000);
}

interface FilesEvent {
  termId: string;
  workspaceId: string;
  paths: string[];
  tool?: string;
}

/** Search box above the file tree: debounced, newest query wins, Esc clears. */
function wireFileSearch(input: HTMLInputElement, tree: FileTree, current: () => Workspace | null) {
  let timer = 0;
  let ticket = 0;
  const run = async () => {
    const query = input.value.trim();
    const ws = current();
    const mine = ++ticket;
    if (!query || !ws?.id) {
      tree.showResults(null);
      return;
    }
    try {
      const res = await SearchFiles(ws.id, query);
      if (mine === ticket) tree.showResults({ entries: res.entries, truncated: res.truncated, query });
    } catch (err) {
      if (mine === ticket) toast(String(err));
    }
  };
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), 250);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      void run();
    }
  });
  // A different workspace starts with an empty search.
  return () => {
    input.value = '';
    void run();
  };
}

/** What the terminal buttons act on: the saved workspace, and whether it has unsaved edits. */
interface Selection {
  workspace: Workspace | null;
  dirty: boolean;
}

function createWorkspaceController(onSelectionChange: (selection: Selection) => void, onDeleted: (workspaceId: string) => void) {
  const listHost = byId('ws-list');
  const editorHost = byId('ws-editor');
  let state: SidebarState = { workspaces: [], problems: [], selectedId: null, draft: null, dirty: false, saving: false };

  const saved = () => state.workspaces.find((w) => w.id === state.selectedId) ?? null;

  const render = (rebuildEditor: boolean) => {
    renderSidebar(listHost, editorHost, state, handlers, rebuildEditor);
    onSelectionChange({ workspace: state.draft?.id ? saved() : null, dirty: state.dirty });
  };

  /** Asks before throwing away unsaved edits. */
  const canLeaveDraft = () =>
    !state.dirty || window.confirm('저장하지 않은 변경 사항이 있습니다. 버리고 이동할까요?');

  const setDraft = (draft: Workspace, rebuildEditor: boolean) => {
    const base = saved() ?? emptyDraft();
    state = { ...state, draft, dirty: isDirty(base, draft) };
    render(rebuildEditor);
  };

  /** Reloads from disk. A failure is shown in the list so the sidebar stays usable. */
  const reload = async (selectId: string | null) => {
    try {
      const res = (await Workspaces()) as ListResult;
      const workspaces = applyOrder(orEmpty(res.workspaces), (w) => w.id, loadWorkspaceOrder());
      const selected = workspaces.find((w) => w.id === selectId) ?? null;
      state = {
        ...state,
        workspaces,
        problems: orEmpty(res.problems),
        selectedId: selected?.id ?? null,
        draft: selected,
        dirty: false,
      };
    } catch (err) {
      state = { ...state, problems: [`워크스페이스 목록: ${String(err)}`] };
    }
    render(true);
  };

  const handlers: SidebarHandlers = {
    select: (id) => {
      if (id === state.selectedId || !canLeaveDraft()) return;
      const ws = state.workspaces.find((w) => w.id === id) ?? null;
      state = { ...state, selectedId: id, draft: ws, dirty: false };
      render(true);
    },
    create: () => {
      if (!canLeaveDraft()) return;
      state = { ...state, selectedId: null, draft: emptyDraft(), dirty: false };
      render(true);
    },
    rename: (name) => state.draft && setDraft({ ...state.draft, name }, false),
    editNotes: (notes) => state.draft && setDraft({ ...state.draft, notes }, false),
    editTopics: (text) => state.draft && setDraft({ ...state.draft, topics: parseTopics(text) }, false),
    addFolder: async () => {
      if (!state.draft) return;
      try {
        const path = await PickFolder();
        if (path && state.draft) setDraft(addFolder(state.draft, path), true);
      } catch (err) {
        toast(`폴더를 고르지 못했습니다: ${String(err)}`);
      }
    },
    removeFolder: (index) => state.draft && setDraft(removeFolder(state.draft, index), true),
    reorderFolders: (from, to, where) => {
      if (state.draft) setDraft({ ...state.draft, folders: moveBy(state.draft.folders, (f) => f, from, to, where) }, true);
    },
    reorderWorkspaces: (from, to, where) => {
      const workspaces = moveBy(state.workspaces, (w) => w.id, from, to, where);
      saveWorkspaceOrder(workspaces.map((w) => w.id));
      state = { ...state, workspaces };
      render(false);
    },
    save: async () => {
      if (!state.draft || state.saving) return; // a double click must not create twice
      const isNew = !state.draft.id;
      state = { ...state, saving: true };
      render(false);
      let result: Workspace;
      try {
        result = await SaveWorkspace(models.Workspace.createFrom(state.draft));
      } catch (err) {
        state = { ...state, saving: false };
        render(false);
        toast(String(err));
        return;
      }
      state = { ...state, saving: false };
      // A new workspace got the widgets that work here; say so once.
      if (isNew) markNewWorkspace(result.id);
      await reload(result.id);
    },
    remove: async () => {
      // Name the saved workspace, not an unsaved edit of its name.
      const draft = saved();
      const message = `「${draft?.name}」 워크스페이스를 삭제할까요? 폴더는 지워지지 않고, 이 워크스페이스에서 연 터미널은 모두 닫힙니다.`;
      if (!draft || !window.confirm(message)) return;
      try {
        await DeleteWorkspace(draft.id);
        onDeleted(draft.id);
        await reload(null);
      } catch (err) {
        toast(String(err));
      }
    },
  };

  // Widget saves run one after another, each computed from the latest saved
  // list, so quick toggles never overwrite each other.
  let widgetQueue: Promise<unknown> = Promise.resolve();

  /**
   * Saves only the widget list of a workspace, keeping unsaved name/notes/
   * folder edits in its draft. Resolves false when the save failed.
   */
  const saveWidgets = (workspaceId: string, update: (prev: Instance[]) => Instance[]): Promise<boolean> => {
    const run = widgetQueue.then(async () => {
      const current = state.workspaces.find((w) => w.id === workspaceId);
      if (!current) return false;
      try {
        const result = await SaveWorkspace(models.Workspace.createFrom({ ...current, widgets: update(current.widgets) }));
        const workspaces = state.workspaces.map((w) => (w.id === result.id ? result : w));
        // Only the draft of this workspace gets the new widgets; the user may have switched meanwhile.
        const draft = state.draft?.id === result.id ? { ...state.draft, widgets: result.widgets } : state.draft;
        state = { ...state, workspaces, draft };
        if (state.selectedId === result.id) render(false);
        return true;
      } catch (err) {
        toast(String(err));
        return false;
      }
    });
    widgetQueue = run;
    return run;
  };

  return { reload, saveWidgets, list: () => state.workspaces };
}

function wireTerminalButtons(panel: TerminalPanel, getSelection: () => Selection) {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-open]')];
  const update = () => {
    const { workspace: ws, dirty } = getSelection();
    for (const b of buttons) {
      // Opening with unsaved folders/notes would silently use the old ones.
      b.disabled = !ws || dirty;
      b.title = !ws ? '워크스페이스를 먼저 선택하세요' : dirty ? '변경 사항을 먼저 저장하세요' : `${ws.name} 에서 열기`;
    }
  };
  for (const b of buttons) {
    b.addEventListener('click', () => {
      const { workspace: ws } = getSelection();
      if (ws) void panel.open(b.dataset.open as TerminalKind, ws.id);
    });
  }
  update();
  return update;
}

/**
 * Reopens Claude sessions that were running when the app last exited, for
 * workspaces whose session-restore widget allows it.
 */
const MAX_RESTORE = 5;

async function restoreSessions(panel: TerminalPanel, list: Workspace[]) {
  try {
    const wanted = orEmpty(await RestorableSessions()).filter((rec) => {
      const ws = list.find((w) => w.id === rec.workspaceId);
      const widget = orEmpty(ws?.widgets).find((w) => w.type === 'session-restore');
      return widget?.enabled && widget.settings?.resumeClaude !== false;
    });
    if (!wanted.length) return;
    const batch = wanted.slice(0, MAX_RESTORE);
    await Promise.all(batch.map((rec) => panel.resume(rec.workspaceId, rec.sessionId)));
    const skipped = wanted.length - batch.length;
    toast(`지난번에 열려 있던 Claude 세션 ${batch.length}개를 이어서 열었습니다${skipped ? ` (나머지 ${skipped}개는 「세션 복원」 위젯에서)` : ''}`);
  } catch (err) {
    // Restoring is a convenience; it must never stop the dashboard from starting.
    console.error('session restore failed', err);
  }
}

async function start() {
  const stopSplitters = mountSplitters(byId('app'));
  import.meta.hot?.dispose(stopSplitters);
  let selection: Selection = { workspace: null, dirty: false };
  const editorBody = byId('editor-body');
  const emptyNote = byId('editor-empty');
  const tabs = new TabHost(byId('editor-tabs'), editorBody, (active) => emptyNote.classList.toggle('hidden', active !== null));
  const panel = new TerminalPanel(tabs, editorBody, toast);
  const office = startOffice(panel, tabs, () => selection.workspace);
  import.meta.hot?.dispose(() => office?.stop());
  const viewer = new FileViewer(tabs, toast);
  import.meta.hot?.dispose(() => {
    panel.dispose();
    viewer.dispose();
  });
  const tree = new FileTree(byId('file-tree'), (path) => void viewer.open(path, true, selection.workspace?.id));
  const resetSearch = wireFileSearch(byId<HTMLInputElement>('file-search'), tree, () => selection.workspace);

  // Claude (via the dashboard MCP tool) asked to show files: list them and open
  // tabs. Only bring the first one to the front when it is the workspace in view.
  const offOpen = EventsOn('files:open', (ev: FilesEvent) => {
    tree.opened(ev.workspaceId, ev.paths);
    const inView = ev.workspaceId === selection.workspace?.id;
    ev.paths.forEach((p, i) => void viewer.open(p, inView && i === 0, ev.workspaceId));
  });
  const offSeen = EventsOn('files:seen', (ev: FilesEvent) => {
    for (const p of ev.paths) tree.seen(ev.workspaceId, p, ev.tool ?? '');
  });
  import.meta.hot?.dispose(() => {
    offOpen();
    offSeen();
  });

  const updateButtons = wireTerminalButtons(panel, () => selection);
  // eslint-disable-next-line prefer-const -- assigned after the controller that calls back into it
  let board: WidgetBoard;
  let shownGroup: string | null | undefined;
  const workspaces = createWorkspaceController((next) => {
    selection = next;
    updateButtons();
    // Terminals and files belong to the workspace that opened them.
    const group = next.workspace?.id ?? null;
    if (group !== shownGroup) {
      shownGroup = group;
      tabs.setGroup(group);
      resetSearch();
    }
    office?.refresh(); // also picks up a renamed workspace
    tree.show(next.workspace); // re-renders only when the workspace or its folders changed
    board?.show(next.workspace);
  }, (workspaceId) => {
    // A deleted workspace's terminals have nowhere to be shown any more.
    for (const t of panel.list()) {
      if (t.workspaceId === workspaceId) panel.close(t.id).catch((err) => toast(`터미널을 닫지 못했습니다: ${String(err)}`));
    }
  });
  board = new WidgetBoard(byId('widget-board'), workspaces.saveWidgets, toast, (workspaceId, widgetId) => ({
    startQA: (feature, mode) => void panel.startQA(workspaceId, feature, mode),
    resume: (sessionId) => void panel.resume(workspaceId, sessionId),
    openFile: widgetId
      ? (name) => void OpenWidgetFile(workspaceId, widgetId, name).catch((err) => toast(`파일을 열지 못했습니다: ${String(err)}`))
      : undefined,
    todo: {
      add: async (text) => ((await AddTodo(workspaceId, text)) ?? []) as TodoItem[],
      setDone: async (id, done) => ((await SetTodoDone(workspaceId, id, done)) ?? []) as TodoItem[],
      remove: async (id) => ((await DeleteTodo(workspaceId, id)) ?? []) as TodoItem[],
    },
  }));
  import.meta.hot?.dispose(() => board.destroy());
  // Ctrl + / Ctrl - / Ctrl 0: the remembered zoom, terminals follow with their font size.
  const onZoom = (z: number) => panel.setFontScale(z);
  setZoom(loadZoom(), onZoom);
  const stopZoomGuard = guardZoomKeys(window, (dir) => {
    const next = stepZoom(currentZoom(), dir);
    setZoom(next, onZoom);
    toast(`화면 크기 ${Math.round(next * 100)}%`);
  });
  import.meta.hot?.dispose(stopZoomGuard);

  const loadCatalog = async () => {
    try {
      board.setCatalog(orEmpty((await WidgetCatalog()) as Definition[]));
    } catch (err) {
      board.setCatalogError(String(err), () => void loadCatalog());
    }
  };
  // reload() reports its own errors in the sidebar.
  await Promise.all([loadCatalog(), workspaces.reload(null)]);
  board.show(selection.workspace);
  await restoreSessions(panel, workspaces.list());
}

start().catch((err) => {
  document.body.replaceChildren(el('p', 'error', `대시보드를 시작하지 못했습니다: ${String(err)}`));
});
