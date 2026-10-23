import './styles/tokens.css';
import './styles/app.css';

import { WidgetCatalog, Workspaces } from '../wailsjs/go/main/App';
import { groupBySource, orEmpty, type Definition, type ListResult, type Workspace } from './lib/widgets';
import { mountFloor } from './office/floor';

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

function renderWorkspaces(target: HTMLElement, list: Workspace[], problems: string[]) {
  const items = list.map((ws) => el('li', '', ws.name));
  const empty = list.length === 0 ? [el('li', 'muted', '아직 워크스페이스가 없습니다.')] : [];
  const errors = problems.map((p) => el('li', 'error', `불러오지 못함: ${p}`));
  target.replaceChildren(...items, ...empty, ...errors);
}

function showError(target: HTMLElement, message: string, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  target.replaceChildren(el('li', 'error', `${message}: ${detail}`));
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

async function start() {
  const stopFloor = startFloor();
  import.meta.hot?.dispose(() => stopFloor?.());

  const catalogEl = byId('catalog');
  const workspacesEl = byId('workspaces');

  const [catalog, workspaces] = await Promise.allSettled([WidgetCatalog(), Workspaces()]);

  // Wails models are generated from Go structs; the shapes match ./lib/widgets.
  if (catalog.status === 'fulfilled') renderCatalog(catalogEl, orEmpty(catalog.value as Definition[]));
  else showError(catalogEl, '위젯 목록을 불러오지 못했습니다', catalog.reason);

  if (workspaces.status === 'fulfilled') {
    const res = workspaces.value as ListResult;
    renderWorkspaces(workspacesEl, orEmpty(res.workspaces), orEmpty(res.problems));
  } else {
    showError(workspacesEl, '워크스페이스를 불러오지 못했습니다', workspaces.reason);
  }
}

start().catch((err) => {
  document.body.replaceChildren(el('p', 'error', `대시보드를 시작하지 못했습니다: ${String(err)}`));
});
