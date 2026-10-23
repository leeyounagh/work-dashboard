import { ClaudeStatus, RefreshWidget, WidgetData } from '../../wailsjs/go/main/App';
import { BrowserOpenURL } from '../../wailsjs/runtime/runtime';
import type { Definition, Instance, Workspace } from '../lib/widgets';
import {
  h,
  renderCIFailures,
  renderClaudeUsage,
  renderJSON,
  renderPlanned,
  renderPRReviews,
  renderReviewQueue,
  type CIFailuresData,
  type ClaudeUsageData,
  type PRReviewsData,
  type ReviewQueueData,
} from './renderers';
import { formatSetting, parseSetting } from './settingsForm';
import { renderLocal, type WidgetActions } from './localRenderers';
import { collapseKey, loadCollapsed, saveCollapsed, toggleCollapsed, type Collapsed } from './collapse';
import { removeWidget, renderManager, updateWidget, upsertWidget, widgetKey, type SaveWidgets } from './manager';

export { upsertWidget, type SaveWidgets };
import { makeSortable, moveBy, type Where } from '../lib/sortable';

const AUTO_REFRESH_MS = 3 * 60 * 1000;

interface Result {
  type: string;
  data?: unknown;
  error?: string;
}

const open = (url: string) => BrowserOpenURL(url);

export function renderData(type: string, data: unknown, actions?: WidgetActions): HTMLElement {
  if (data && typeof data === 'object' && (data as { planned?: boolean }).planned) {
    return renderPlanned(data as { message: string });
  }
  switch (type) {
    case 'pr-reviews':
      return renderPRReviews(data as PRReviewsData, open);
    case 'ci-failures':
      return renderCIFailures(data as CIFailuresData, open);
    case 'review-queue':
      return renderReviewQueue(data as ReviewQueueData, open);
    case 'claude-usage':
      return renderClaudeUsage(data as ClaudeUsageData);
    default:
      return renderLocal(type, data, open, actions) ?? renderJSON(data);
  }
}

/** Moves a widget (by key) before/after another one. */
export function moveWidget(prev: Instance[], from: string, to: string, where: Where): Instance[] {
  return moveBy(prev, widgetKey, from, to, where);
}

/** Key for "already alerted": one per limit window, or per hour when the reset time is unknown. */
export function alertKey(windowKey: string, resetsAt: string, now = Date.now()): string {
  const t = Date.parse(resetsAt);
  if (!Number.isFinite(t) || t <= 0 || resetsAt.startsWith('0001')) return `${windowKey}@hour-${Math.floor(now / 3_600_000)}`;
  return `${windowKey}@${resetsAt}`;
}

type CatalogState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string; retry: () => void };

/** The right-hand column: the selected workspace's widgets. */
export class WidgetBoard {
  private workspace: Workspace | null = null;
  private catalog: Definition[] = [];
  private catalogState: CatalogState = { kind: 'loading' };
  private managing = false;
  private timer = 0;
  private generation = 0; // bumps on every render; drops stale responses
  private loaders: Array<() => Promise<void>> = [];
  private collapsed: Collapsed = loadCollapsed();
  private readonly alerted = new Set<string>();

  constructor(
    private readonly host: HTMLElement,
    private readonly saveWidgets: SaveWidgets,
    private readonly toast: (message: string) => void,
    private readonly actionsFor: (workspaceId: string, widgetId?: string) => WidgetActions,
  ) {}

  setCatalog(catalog: Definition[]): void {
    this.catalog = catalog;
    this.catalogState = { kind: 'ready' };
    this.render();
  }

  setCatalogError(message: string, retry: () => void): void {
    this.catalogState = { kind: 'error', message, retry };
    this.render();
  }

  show(ws: Workspace | null): void {
    const sameId = ws?.id === this.workspace?.id;
    const sameWidgets = JSON.stringify(ws?.widgets) === JSON.stringify(this.workspace?.widgets);
    this.workspace = ws;
    if (sameId && sameWidgets) return;
    if (!sameId) this.managing = false;
    this.render();
  }

  destroy(): void {
    window.clearInterval(this.timer);
    this.generation++;
  }

  private def(type: string): Definition | undefined {
    return this.catalog.find((d) => d.id === type);
  }

  private render() {
    this.generation++;
    this.loaders = [];
    window.clearInterval(this.timer);
    const ws = this.workspace;
    const head = h('div', 'w-head');
    head.append(h('h2', '', 'Widgets'));
    if (ws?.id && this.catalogState.kind === 'ready') {
      const manage = h('button', 'ghost small-btn', this.managing ? '완료' : '위젯 관리');
      manage.addEventListener('click', () => {
        this.managing = !this.managing;
        this.render();
      });
      head.append(manage);
    }

    const cs = this.catalogState;
    if (cs.kind === 'loading') {
      this.host.replaceChildren(head, h('p', 'muted', '위젯을 불러오는 중…'));
      return;
    }
    if (cs.kind === 'error') {
      const retry = h('button', 'ghost', '다시 시도');
      retry.addEventListener('click', () => cs.retry());
      const box = h('div', 'w-card');
      box.append(h('p', 'error small', `위젯 목록을 불러오지 못했습니다: ${cs.message}`), retry);
      this.host.replaceChildren(head, box);
      return;
    }

    if (!ws?.id) {
      this.host.replaceChildren(head, this.globalClaudeCard());
    } else if (this.managing) {
      this.host.replaceChildren(head, renderManager(ws, this.catalog, this.saveWidgets, this.toast, () => this.render()));
      return;
    } else {
      const cards = ws.widgets.map((inst, index) => ({ inst, index })).filter(({ inst }) => inst.enabled);
      const nodes = cards.map(({ inst, index }) =>
        this.def(inst.type) ? this.card(ws, inst, index) : h('p', 'muted small', `알 수 없는 위젯: ${inst.type}`),
      );
      if (!nodes.length) nodes.push(h('p', 'muted', '켜진 위젯이 없습니다. 「위젯 관리」에서 켜세요.'));
      this.host.replaceChildren(head, ...nodes);
      // Drag a card by its ⠿ grip to change the order (saved with the workspace).
      makeSortable(this.host, '.w-card[data-sort-key]', (from, to, where) => {
        void this.saveWidgets(ws.id, (prev) => moveWidget(prev, from, to, where));
      }, '.w-grip');
    }
    this.timer = window.setInterval(() => {
      if (document.hidden) return; // no polling while the window is hidden
      for (const load of this.loaders) void load();
    }, AUTO_REFRESH_MS);
  }

  private globalClaudeCard(): HTMLElement {
    const card = h('section', 'w-card');
    const body = h('div', 'w-body', '불러오는 중…');
    card.append(h('h3', 'w-title', 'Claude 한도·로그인'), body);
    const gen = this.generation;
    const load = async () => {
      try {
        const d = (await ClaudeStatus()) as unknown as ClaudeUsageData;
        if (gen !== this.generation) return;
        body.replaceChildren(renderClaudeUsage(d));
        this.maybeAlert({ type: 'claude-usage', data: d });
      } catch (err) {
        if (gen === this.generation) body.replaceChildren(h('p', 'error small', String(err)));
      }
    };
    this.loaders.push(load);
    void load();
    return card;
  }

  private card(ws: Workspace, inst: Instance, index: number): HTMLElement {
    const def = this.def(inst.type)!;
    const key = collapseKey(ws.id, widgetKey(inst));
    const card = h('section', 'w-card');
    card.dataset.sortKey = widgetKey(inst);
    const title = h('div', 'w-card-head');
    const grip = h('span', 'w-grip', '⠿');
    grip.title = '드래그해서 순서 바꾸기';
    const when = h('span', 'w-when muted', '');
    const reload = h('button', 'icon', '↻');
    reload.title = '새로고침';
    const gear = h('button', 'ghost small-btn', '설정');
    gear.title = '이 위젯의 설정 바꾸기';
    const toggle = h('button', 'w-toggle');
    toggle.type = 'button';
    toggle.append(h('span', 'w-chevron', '▾'), h('h3', 'w-title', inst.title || def.name));
    title.append(grip, toggle, when, reload, gear);
    const body = h('div', 'w-body', '불러오는 중…');
    const settings = h('div', 'w-settings hidden');
    card.append(title, settings, body);

    const gen = this.generation;
    let busy = false;
    const load = async (fresh: boolean) => {
      if (busy) return; // a slow load is still running
      busy = true;
      reload.disabled = true;
      try {
        const res = (await (fresh ? RefreshWidget : WidgetData)(ws.id, index)) as Result;
        if (gen !== this.generation) return;
        if (res.error) body.replaceChildren(h('p', 'error small', res.error));
        else body.replaceChildren(renderData(res.type, res.data, this.actionsFor(ws.id, inst.id)));
        when.textContent = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        this.maybeAlert(res);
      } catch (err) {
        if (gen === this.generation) body.replaceChildren(h('p', 'error small', String(err)));
      } finally {
        busy = false;
        reload.disabled = false;
      }
    };
    // Collapsed cards show only their header and do not load (connector
    // widgets cost Claude usage); expanding loads them.
    let loaded = false;
    const applyCollapsed = () => {
      const collapsed = Boolean(this.collapsed[key]);
      card.classList.toggle('collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.title = collapsed ? '펼치기' : '접기';
      (toggle.firstChild as HTMLElement).textContent = collapsed ? '▸' : '▾';
      if (!collapsed && !loaded) {
        loaded = true;
        void load(false);
      }
    };
    toggle.addEventListener('click', () => {
      this.collapsed = toggleCollapsed(this.collapsed, key);
      saveCollapsed(this.collapsed);
      applyCollapsed();
    });
    // Auto refresh reuses the backend cache; the button asks for fresh data.
    this.loaders.push(async () => {
      if (!this.collapsed[key]) await load(false);
    });
    reload.addEventListener('click', () => {
      loaded = true;
      void load(true);
    });
    gear.addEventListener('click', () => {
      if (this.collapsed[key]) toggle.click(); // open the card to show its settings
      settings.classList.toggle('hidden');
      if (!settings.classList.contains('hidden')) settings.replaceChildren(this.settingsForm(ws, inst));
    });
    applyCollapsed();
    return card;
  }

  /** Toasts once per limit window when Claude usage crosses the alert line. */
  private maybeAlert(res: Result) {
    if (res.type !== 'claude-usage' || !res.data) return;
    const d = res.data as ClaudeUsageData;
    for (const w of d.usage.windows ?? []) {
      const key = alertKey(w.key, w.resetsAt);
      if (w.percent >= d.alertPercent && !this.alerted.has(key)) {
        this.alerted.add(key);
        this.toast(`Claude ${w.label} 한도 ${Math.round(w.percent)}% 사용 — 리셋 전까지 아껴 쓰세요`);
      }
    }
  }

  private settingsForm(ws: Workspace, inst: Instance): HTMLElement {
    const def = this.def(inst.type)!;
    const form = h('form', 'w-form');
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    for (const spec of def.settings) {
      const current = inst.settings && spec.key in inst.settings ? inst.settings[spec.key] : spec.default;
      const id = `w-${widgetKey(inst)}-${spec.key}`;
      const label = h('label', 'label', spec.label);
      label.htmlFor = id;
      let input: HTMLInputElement | HTMLSelectElement;
      if (spec.kind === 'enum') {
        const sel = h('select', 'field');
        for (const opt of spec.options ?? []) {
          const o = h('option', '', opt);
          o.value = opt;
          o.selected = opt === current;
          sel.append(o);
        }
        input = sel;
      } else {
        const inp = h('input', spec.kind === 'bool' ? '' : 'field');
        inp.type = spec.kind === 'bool' ? 'checkbox' : spec.kind === 'int' ? 'number' : 'text';
        if (spec.kind === 'bool') inp.checked = Boolean(current);
        else inp.value = formatSetting(spec, current);
        if (spec.kind === 'stringList') inp.placeholder = '쉼표로 구분';
        input = inp;
      }
      input.id = id;
      inputs.set(spec.key, input);
      form.append(label, input);
    }
    // Repeatable widgets have their own name and can be deleted.
    let titleInput: HTMLInputElement | null = null;
    if (inst.id) {
      titleInput = h('input', 'field');
      titleInput.id = `w-${inst.id}-title`;
      titleInput.value = inst.title ?? '';
      titleInput.maxLength = 60;
      const label = h('label', 'label', '위젯 이름');
      label.htmlFor = titleInput.id;
      form.prepend(label, titleInput);
    }
    const save = h('button', 'primary', '저장');
    save.type = 'submit';
    const actions = h('div', 'actions');
    actions.append(save);
    if (inst.id) {
      const del = h('button', 'danger', '위젯 삭제');
      del.type = 'button';
      del.addEventListener('click', () => {
        if (window.confirm(`「${inst.title || def.name}」 위젯을 삭제할까요?`)) void this.saveWidgets(ws.id, (prev) => removeWidget(prev, inst.id!));
      });
      actions.append(del);
    }
    form.append(actions);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (save.disabled) return;
      const next: Record<string, unknown> = {};
      for (const spec of def.settings) {
        const input = inputs.get(spec.key)!;
        const raw = spec.kind === 'bool' ? (input as HTMLInputElement).checked : input.value;
        const parsed = parseSetting(spec, raw);
        if (!parsed.ok) {
          this.toast(parsed.error);
          return;
        }
        next[spec.key] = parsed.value;
      }
      save.disabled = true;
      const title = titleInput?.value.trim();
      void this.saveWidgets(ws.id, (prev) =>
        updateWidget(prev, widgetKey(inst), (w) => ({ ...w, settings: next, ...(title !== undefined ? { title } : {}) })),
      ).finally(() => (save.disabled = false));
    });
    return form;
  }

}
