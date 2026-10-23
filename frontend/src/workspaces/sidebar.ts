import type { Workspace } from '../lib/widgets';

export interface SidebarState {
  workspaces: Workspace[];
  problems: string[];
  selectedId: string | null;
  draft: Workspace | null; // the workspace being edited (id '' = new)
  dirty: boolean;
  saving: boolean; // a save is in flight
}

export interface SidebarHandlers {
  select(id: string): void;
  create(): void;
  rename(name: string): void;
  editNotes(notes: string): void;
  addFolder(): void;
  removeFolder(index: number): void;
  save(): void;
  remove(): void;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = node('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function renderList(state: SidebarState, h: SidebarHandlers): HTMLElement {
  const list = node('ul', 'list');
  for (const ws of state.workspaces) {
    const selected = ws.id === state.selectedId;
    const item = button(ws.name, selected ? 'ws-item selected' : 'ws-item', () => h.select(ws.id));
    item.title = ws.folders.join('\n');
    item.setAttribute('aria-current', String(selected));
    const li = node('li', 'ws-row');
    li.append(item);
    list.append(li);
  }
  if (state.workspaces.length === 0 && !state.draft) {
    list.append(node('li', 'muted', '아직 워크스페이스가 없습니다.'));
  }
  for (const p of state.problems) list.append(node('li', 'error', `불러오지 못함: ${p}`));
  return list;
}

const canSave = (s: SidebarState) => !!s.draft && s.dirty && !s.saving && s.draft.name.trim() !== '';

function label(text: string, htmlFor: string): HTMLLabelElement {
  const l = node('label', 'label', text);
  l.htmlFor = htmlFor;
  return l;
}

function renderEditor(state: SidebarState, draft: Workspace, h: SidebarHandlers): HTMLElement {
  const form = node('div', 'ws-editor');

  const name = node('input', 'field');
  name.id = 'ws-name';
  name.placeholder = '워크스페이스 이름';
  name.value = draft.name;
  name.addEventListener('input', () => h.rename(name.value));

  const folders = node('ul', 'folders');
  draft.folders.forEach((f, i) => {
    const li = node('li', 'folder');
    li.append(node('span', 'folder-path', f), button('×', 'icon', () => h.removeFolder(i)));
    li.title = f;
    folders.append(li);
  });
  if (draft.folders.length === 0) folders.append(node('li', 'muted', 'Claude 가 함께 볼 폴더를 추가하세요.'));

  const notes = node('textarea', 'field notes');
  notes.id = 'ws-notes';
  notes.placeholder = 'Claude 에게 줄 메모 (예: PR 은 test 브랜치로)';
  notes.rows = 4;
  notes.value = draft.notes ?? '';
  notes.addEventListener('input', () => h.editNotes(notes.value));

  const actions = node('div', 'actions');
  const save = button(draft.id ? '저장' : '만들기', 'primary', () => h.save());
  save.disabled = !canSave(state);
  actions.append(save);
  if (draft.id) actions.append(button('삭제', 'danger', () => h.remove()));

  form.append(
    label('이름', 'ws-name'),
    name,
    node('span', 'label', '폴더'),
    folders,
    button('+ 폴더 추가', 'ghost', () => h.addFolder()),
    label('메모', 'ws-notes'),
    notes,
    actions,
  );
  return form;
}

/** Re-renders the sidebar. Inputs keep focus because only the list is
 * replaced on selection changes; the editor is rebuilt only when asked. */
export function renderSidebar(
  listHost: HTMLElement,
  editorHost: HTMLElement,
  state: SidebarState,
  h: SidebarHandlers,
  rebuildEditor: boolean,
): void {
  listHost.replaceChildren(renderList(state, h), button('+ 새 워크스페이스', 'ghost', () => h.create()));
  if (rebuildEditor) {
    editorHost.replaceChildren(...(state.draft ? [renderEditor(state, state.draft, h)] : []));
  } else {
    const save = editorHost.querySelector<HTMLButtonElement>('.actions .primary');
    if (save) save.disabled = !canSave(state);
  }
}
