import './styles/tokens.css';
import './styles/app.css';

import {
  DeleteWorkspace,
  PickFolder,
  SaveWorkspace,
  WidgetCatalog,
  Workspaces,
} from '../wailsjs/go/main/App';
import { workspace as models } from '../wailsjs/go/models';
import { groupBySource, orEmpty, type Definition, type ListResult, type Workspace } from './lib/widgets';
import { addFolder, emptyDraft, isDirty, removeFolder } from './lib/workspaceDraft';
import { mountFloor } from './office/floor';
import { TerminalPanel, type TerminalKind } from './terminal/panel';
import { renderSidebar, type SidebarHandlers, type SidebarState } from './workspaces/sidebar';

const SOURCE_LABEL: Partial<Record<string, string>> = {
  github: 'GitHub',
  claude: 'Claude',
  local: '로컬',
};

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

function renderCatalog(target: HTMLElement, catalog: Definition[]) {
  const items = groupBySource(catalog).flatMap((group) => [
    el('li', 'group', SOURCE_LABEL[group.source] ?? group.source),
    ...group.items.map((def) => {
      const li = el('li', '', def.name);
      li.title = def.description;
      return li;
    }),
  ]);
  target.replaceChildren(...items);
}

function startFloor(): (() => void) | undefined {
  try {
    return mountFloor(byId<HTMLCanvasElement>('floor'));
  } catch (err) {
    // The floor is decorative; the rest of the dashboard should still load.
    console.error('office floor failed to start', err);
    return undefined;
  }
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

/** What the terminal buttons act on: the saved workspace, and whether it has unsaved edits. */
interface Selection {
  workspace: Workspace | null;
  dirty: boolean;
}

function createWorkspaceController(onSelectionChange: (selection: Selection) => void) {
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
      const workspaces = orEmpty(res.workspaces);
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
    save: async () => {
      if (!state.draft || state.saving) return; // a double click must not create twice
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
      await reload(result.id);
    },
    remove: async () => {
      // Name the saved workspace, not an unsaved edit of its name.
      const draft = saved();
      const message = `「${draft?.name}」 워크스페이스를 삭제할까요? 폴더는 지워지지 않고, 열린 터미널은 계속 실행됩니다.`;
      if (!draft || !window.confirm(message)) return;
      try {
        await DeleteWorkspace(draft.id);
        await reload(null);
      } catch (err) {
        toast(String(err));
      }
    },
  };

  return { reload };
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

async function start() {
  const stopFloor = startFloor();
  import.meta.hot?.dispose(() => stopFloor?.());

  let selection: Selection = { workspace: null, dirty: false };
  const panel = new TerminalPanel(byId('term-tabs'), byId('term-body'), toast);
  import.meta.hot?.dispose(() => panel.dispose());
  const updateButtons = wireTerminalButtons(panel, () => selection);
  const workspaces = createWorkspaceController((next) => {
    selection = next;
    updateButtons();
  });

  const catalogEl = byId('catalog');
  // reload() reports its own errors in the sidebar.
  const [catalog] = await Promise.allSettled([WidgetCatalog(), workspaces.reload(null)]);
  if (catalog.status === 'fulfilled') renderCatalog(catalogEl, orEmpty(catalog.value as Definition[]));
  else catalogEl.replaceChildren(el('li', 'error', `위젯 목록을 불러오지 못했습니다: ${String(catalog.reason)}`));
}

start().catch((err) => {
  document.body.replaceChildren(el('p', 'error', `대시보드를 시작하지 못했습니다: ${String(err)}`));
});
