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

export function newWidgetId(type: string): string {
  const rand = Math.random().toString(16).slice(2, 8).padEnd(6, '0');
  return `${type}-${rand}`;
}

/** Adds a recommended widget: repeatable ones are appended, single ones enabled with the suggested settings. */
export function applyRecommendation(prev: Instance[], rec: Instance): Instance[] {
  if (rec.id) return prev.some((w) => w.id === rec.id) ? prev : [...prev, { ...rec, enabled: true }];
  return upsertWidget(prev, rec.type, (w) => ({ ...w, enabled: true, settings: { ...(w.settings ?? {}), ...(rec.settings ?? {}) } }));
}

interface Recommendation {
  instance: Instance;
  reason: string;
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
  const box = h('div', 'w-manager');
  box.append(h('h3', 'w-section', '켜고 끄기'));
  const boxes: HTMLInputElement[] = [];
  for (const def of catalog.filter((d) => !d.multiple)) {
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
    const text = h('span', '');
    text.append(h('strong', '', def.name), h('span', 'muted small-inline', ` ${def.description}`));
    row.append(check, text);
    box.append(row);
  }

  box.append(h('h3', 'w-section', '+ 위젯 추가'));
  for (const def of catalog.filter((d) => d.multiple)) {
    const row = h('div', 'w-manage-row');
    const add = h('button', 'ghost small-btn', '추가');
    add.type = 'button';
    add.addEventListener('click', async () => {
      const title = window.prompt(`${def.name} 위젯 이름`, def.name)?.trim();
      if (!title) return;
      const inst: Instance = { type: def.id, id: newWidgetId(def.id), title: title.slice(0, 60), enabled: true, settings: {} };
      if (await saveWidgets(ws.id, (prev) => [...prev, inst])) toast(`「${inst.title}」 위젯을 추가했습니다. 카드의 「설정」에서 내용을 입력하세요.`);
    });
    const text = h('span', '');
    text.append(h('strong', '', def.name), h('span', 'muted small-inline', ` ${def.description}`));
    row.append(add, text);
    box.append(row);
  }

  box.append(h('h3', 'w-section', 'Claude 에게 추천받기'));
  const ask = h('textarea', 'field');
  ask.rows = 2;
  ask.maxLength = 500;
  ask.placeholder = '원하는 것을 적어 보세요 (예: CI 실패한 내 PR만 보여줘). 비워 두면 이 워크스페이스에 맞는 위젯을 추천합니다.';
  const go = h('button', 'primary', '추천받기');
  go.type = 'button';
  const note = h('p', 'muted small', 'Claude 에게 보내는 정보: 폴더 이름, 레포 이름, 지금 켜진 위젯 목록, 위에 적은 요청. Claude 는 도구 없이 추천만 합니다.');
  const results = h('div', 'w-list');
  go.addEventListener('click', async () => {
    go.disabled = true;
    results.replaceChildren(h('p', 'muted small', '추천을 받는 중… (30초쯤 걸립니다)'));
    try {
      const recs = ((await RecommendWidgets(ws.id, ask.value)) ?? []) as unknown as Recommendation[];
      if (!recs.length) {
        results.replaceChildren(h('p', 'muted small', '추가로 추천할 위젯이 없습니다.'));
        return;
      }
      results.replaceChildren(
        ...recs.map((rec) => {
          const def = catalog.find((d) => d.id === rec.instance.type);
          const item = h('div', 'w-item');
          const add = h('button', 'ghost small-btn', '추가');
          add.type = 'button';
          add.addEventListener('click', async () => {
            add.disabled = true;
            if (await saveWidgets(ws.id, (prev) => applyRecommendation(prev, rec.instance))) add.textContent = '추가됨';
            else add.disabled = false;
          });
          const title = h('div', 'w-pr-title');
          title.append(h('strong', '', rec.instance.title || def?.name || rec.instance.type), add);
          item.append(title, h('div', 'muted small-inline', rec.reason));
          return item;
        }),
      );
    } catch (err) {
      results.replaceChildren(h('p', 'error small', String(err)));
    } finally {
      go.disabled = false;
    }
  });
  box.append(ask, go, note, results);
  return box;
}
