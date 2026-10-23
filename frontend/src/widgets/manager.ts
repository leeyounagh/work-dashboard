import { RecommendWidgets } from '../../wailsjs/go/main/App';
import type { Definition, Instance, Workspace } from '../lib/widgets';
import { h } from './renderers';

/** Saves a workspace's widget list; resolves false when saving failed. */
export type SaveWidgets = (workspaceId: string, update: (prev: Instance[]) => Instance[]) => Promise<boolean>;

/** Identity of a widget in a workspace: its id for repeatable widgets, else its type. */
export const widgetKey = (w: Instance) => w.id || w.type;

/** Adds or updates the single instance of a widget type. */
export function upsertWidget(prev: Instance[], type: string, change: (inst: Instance) => Instance): Instance[] {
  const i = prev.findIndex((w) => !w.id && w.type === type);
  if (i < 0) return [...prev, change({ type, enabled: false, settings: {} })];
  return prev.map((w, j) => (j === i ? change(w) : w));
}

/** Updates the widget with a key (id or type). */
export function updateWidget(prev: Instance[], key: string, change: (inst: Instance) => Instance): Instance[] {
  return prev.map((w) => (widgetKey(w) === key ? change(w) : w));
}

export function removeWidget(prev: Instance[], key: string): Instance[] {
  return prev.filter((w) => widgetKey(w) !== key);
}

/** A fresh `<type>-<6 hex>` id (the backend's pattern) not used in the list. */
export function newWidgetId(type: string, existing: Instance[]): string {
  const taken = new Set(existing.map((w) => w.id));
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(3));
    const id = `${type}-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Adds a recommended widget: repeatable ones are appended, single ones get the
 * suggested settings and the recommendation's on/off.
 */
export function applyRecommendation(prev: Instance[], rec: Instance): Instance[] {
  if (rec.id) return prev.some((w) => w.id === rec.id) ? prev : [...prev, { ...rec }];
  return upsertWidget(prev, rec.type, (w) => ({
    ...w,
    enabled: rec.enabled,
    settings: { ...(w.settings ?? {}), ...(rec.settings ?? {}) },
  }));
}

/** Whether a recommendation is already in the saved widgets. */
export function isAdded(widgets: Instance[], rec: Instance): boolean {
  if (rec.id) return widgets.some((w) => w.id === rec.id);
  return widgets.some((w) => !w.id && w.type === rec.type && w.enabled);
}

/** "key: value · key: value" of the non-empty suggested settings. */
export function settingsSummary(settings: Record<string, unknown> | undefined): string {
  return Object.entries(settings ?? {})
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' · ');
}

interface Recommendation {
  instance: Instance;
  reason: string;
  suggestedCommand?: string; // shown only; the user types it into the settings
}

/** The request and its answer survive re-renders of the board (per workspace). */
interface AskState {
  request: string;
  recs: Recommendation[] | null;
  error: string;
  busy: boolean;
}
const asks = new Map<string, AskState>();
const askState = (wsId: string): AskState => asks.get(wsId) ?? { request: '', recs: null, error: '', busy: false };

interface ManagerDeps {
  catalog: Definition[];
  saveWidgets: SaveWidgets;
  toast: (message: string) => void;
  rerender: () => void;
}

/**
 * 위젯 관리: switch built-in widgets on and off, add repeatable widgets
 * (command output, links) with a name, or ask Claude for suggestions.
 */
export function renderManager(
  ws: Workspace,
  catalog: Definition[],
  saveWidgets: SaveWidgets,
  toast: (message: string) => void,
  rerender: () => void,
): HTMLElement {
  const deps: ManagerDeps = { catalog, saveWidgets, toast, rerender };
  const box = h('div', 'w-manager');
  box.append(h('h3', 'w-section', '켜고 끄기'), ...toggleRows(ws, deps));
  box.append(h('h3', 'w-section', '+ 위젯 추가'), ...addRows(ws, deps));
  box.append(h('h3', 'w-section', 'Claude 에게 추천받기'), ...askSection(ws, deps));
  return box;
}

function describe(def: Definition): HTMLElement {
  const text = h('span', '');
  text.append(h('strong', '', def.name), h('span', 'muted small-inline', ` ${def.description}`));
  return text;
}

function toggleRows(ws: Workspace, { catalog, saveWidgets, rerender }: ManagerDeps): HTMLElement[] {
  const boxes: HTMLInputElement[] = [];
  return catalog
    .filter((d) => !d.multiple)
    .map((def) => {
      const inst = ws.widgets.find((w) => !w.id && w.type === def.id);
      const row = h('label', 'w-manage-row');
      const check = h('input');
      check.type = 'checkbox';
      check.checked = Boolean(inst?.enabled);
      check.addEventListener('change', async () => {
        const enabled = check.checked;
        for (const b of boxes) b.disabled = true; // one save at a time
        const ok = await saveWidgets(ws.id, (prev) => upsertWidget(prev, def.id, (w) => ({ ...w, enabled })));
        if (!ok) rerender();
        else for (const b of boxes) b.disabled = false;
      });
      boxes.push(check);
      row.append(check, describe(def));
      return row;
    });
}

/** Each repeatable widget gets an "추가" button that opens a name field in place. */
function addRows(ws: Workspace, { catalog, saveWidgets, toast }: ManagerDeps): HTMLElement[] {
  return catalog
    .filter((d) => d.multiple)
    .map((def) => {
      const row = h('div', 'w-manage-row');
      const add = h('button', 'ghost small-btn', '추가');
      add.type = 'button';
      add.addEventListener('click', () => {
        const form = h('form', 'w-inline-add');
        const name = h('input', 'field');
        name.value = def.name;
        name.maxLength = 60;
        name.setAttribute('aria-label', `${def.name} 위젯 이름`);
        const ok = h('button', 'primary small-btn', '만들기');
        ok.type = 'submit';
        const cancel = h('button', 'ghost small-btn', '취소');
        cancel.type = 'button';
        const close = () => form.replaceWith(add);
        cancel.addEventListener('click', close);
        name.addEventListener('keydown', (e) => e.key === 'Escape' && close());
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const title = name.value.trim().slice(0, 60);
          if (!title) return;
          ok.disabled = true;
          const saved = await saveWidgets(ws.id, (prev) => [
            ...prev,
            { type: def.id, id: newWidgetId(def.id, prev), title, enabled: true, settings: {} },
          ]);
          if (saved) toast(`「${title}」 위젯을 추가했습니다. 카드의 「설정」에서 내용을 입력하세요.`);
          else ok.disabled = false;
        });
        form.append(name, ok, cancel);
        add.replaceWith(form);
        name.focus();
        name.select();
      });
      row.append(add, describe(def));
      return row;
    });
}

function askSection(ws: Workspace, deps: ManagerDeps): HTMLElement[] {
  const state = askState(ws.id);
  const ask = h('textarea', 'field');
  ask.rows = 2;
  ask.maxLength = 500;
  ask.value = state.request;
  ask.placeholder = '원하는 것을 적어 보세요 (예: CI 실패한 내 PR만 보여줘). 비워 두면 이 워크스페이스에 맞는 위젯을 추천합니다.';
  ask.addEventListener('input', () => asks.set(ws.id, { ...askState(ws.id), request: ask.value }));
  const go = h('button', 'primary', state.busy ? '추천받는 중…' : '추천받기');
  go.type = 'button';
  go.disabled = state.busy;
  const note = h('p', 'muted small', 'Claude 에게 보내는 정보: 폴더 이름, 레포 이름, 지금 켜진 위젯 목록, 위에 적은 요청. Claude 는 도구 없이 추천만 합니다.');
  go.addEventListener('click', async () => {
    asks.set(ws.id, { ...askState(ws.id), request: ask.value, busy: true, error: '' });
    deps.rerender();
    try {
      const recs = ((await RecommendWidgets(ws.id, ask.value)) ?? []) as unknown as Recommendation[];
      asks.set(ws.id, { ...askState(ws.id), recs, busy: false });
    } catch (err) {
      asks.set(ws.id, { ...askState(ws.id), recs: null, error: String(err), busy: false });
    }
    deps.rerender();
  });
  return [ask, go, note, recommendationList(ws, state, deps)];
}

function recommendationList(ws: Workspace, state: AskState, { catalog, saveWidgets }: ManagerDeps): HTMLElement {
  const results = h('div', 'w-list');
  if (state.busy) results.append(h('p', 'muted small', '추천을 받는 중… (30초쯤 걸립니다)'));
  else if (state.error) results.append(h('p', 'error small', state.error));
  else if (state.recs && !state.recs.length) results.append(h('p', 'muted small', '추가로 추천할 위젯이 없습니다.'));
  for (const rec of state.busy ? [] : (state.recs ?? [])) {
    const def = catalog.find((d) => d.id === rec.instance.type);
    const item = h('div', 'w-item');
    const done = isAdded(ws.widgets, rec.instance);
    const add = h('button', 'ghost small-btn', done ? '추가됨' : '추가');
    add.type = 'button';
    add.disabled = done;
    add.addEventListener('click', async () => {
      add.disabled = true;
      // On success the board re-renders and the row reads 추가됨.
      if (!(await saveWidgets(ws.id, (prev) => applyRecommendation(prev, rec.instance)))) add.disabled = false;
    });
    const title = h('div', 'w-pr-title');
    title.append(h('strong', '', rec.instance.title || def?.name || rec.instance.type), add);
    item.append(title, h('div', 'muted small-inline', rec.reason));
    const summary = settingsSummary(rec.instance.settings);
    if (summary) item.append(h('code', 'w-rec-settings', summary));
    // Claude's command is never saved for it: the user reads it and enters it.
    if (rec.suggestedCommand) {
      item.append(
        h('p', 'muted small', '제안 명령 — 확인한 뒤 위젯 「설정」의 명령 칸에 직접 넣으세요:'),
        h('code', 'w-rec-settings', rec.suggestedCommand),
      );
    }
    results.append(item);
  }
  return results;
}
