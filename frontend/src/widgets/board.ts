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
import { renderLocal } from './localRenderers';

const AUTO_REFRESH_MS = 3 * 60 * 1000;

interface Result {
  type: string;
  data?: unknown;
  error?: string;
}

const open = (url: string) => BrowserOpenURL(url);

export function renderData(type: string, data: unknown): HTMLElement {
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
      return renderLocal(type, data, open) ?? renderJSON(data);
  }
}

/** The right-hand column: the selected workspace's widgets. */
export class WidgetBoard {
  private workspace: Workspace | null = null;
  private catalog: Definition[] = [];
  private managing = false;
  private timer = 0;
  private generation = 0; // bumps when the workspace changes; drops stale responses
  private readonly alerted = new Set<string>();

  constructor(
    private readonly host: HTMLElement,
    private readonly saveWidgets: (widgets: Instance[]) => Promise<void>,
    private readonly toast: (message: string) => void,
  ) {}

  setCatalog(catalog: Definition[]): void {
    this.catalog = catalog;
    this.render();
  }

  show(ws: Workspace | null): void {
    const sameWidgets = JSON.stringify(ws?.widgets) === JSON.stringify(this.workspace?.widgets);
    const sameId = ws?.id === this.workspace?.id;
    this.workspace = ws;
    if (sameId && sameWidgets) return;
    this.render();
  }

  private def(type: string): Definition | undefined {
    return this.catalog.find((d) => d.id === type);
  }

  private render() {
    this.generation++;
    window.clearInterval(this.timer);
    const ws = this.workspace;
    const head = h('div', 'w-head');
    head.append(h('h2', '', 'Widgets'));
    if (ws?.id) {
      const manage = h('button', 'ghost small-btn', this.managing ? '완료' : '위젯 관리');
      manage.addEventListener('click', () => {
        this.managing = !this.managing;
        this.render();
      });
      head.append(manage);
    }
    if (!ws?.id) {
      this.host.replaceChildren(head, this.globalClaudeCard());
      return;
    }
    if (this.managing) {
      this.host.replaceChildren(head, this.manager(ws));
      return;
    }
    const cards = ws.widgets
      .map((inst, index) => ({ inst, index }))
      .filter(({ inst }) => inst.enabled && this.def(inst.type))
      .map(({ inst, index }) => this.card(ws, inst, index));
    if (!cards.length) cards.push(h('p', 'muted', '켜진 위젯이 없습니다. 「위젯 관리」에서 켜세요.'));
    this.host.replaceChildren(head, ...cards);
    this.timer = window.setInterval(() => this.reloadAll(), AUTO_REFRESH_MS);
  }

  private reloadAll() {
    this.host.querySelectorAll<HTMLButtonElement>('.w-card [data-reload]').forEach((b) => b.click());
  }

  private globalClaudeCard(): HTMLElement {
    const card = h('section', 'w-card');
    const body = h('div', 'w-body', '불러오는 중…');
    card.append(h('h3', 'w-title', 'Claude 한도·로그인'), body);
    const gen = this.generation;
    ClaudeStatus()
      .then((d) => {
        if (gen === this.generation) body.replaceChildren(renderClaudeUsage(d as unknown as ClaudeUsageData));
      })
      .catch((err) => body.replaceChildren(h('p', 'error small', String(err))));
    return card;
  }

  private card(ws: Workspace, inst: Instance, index: number): HTMLElement {
    const def = this.def(inst.type)!;
    const card = h('section', 'w-card');
    const title = h('div', 'w-card-head');
    const reload = h('button', 'icon', '↻');
    reload.title = '새로고침';
    reload.dataset.reload = '1';
    const gear = h('button', 'icon', '⚙');
    gear.title = '설정';
    title.append(h('h3', 'w-title', def.name), h('span', 'w-when muted', ''), reload, gear);
    const body = h('div', 'w-body', '불러오는 중…');
    const settings = h('div', 'w-settings hidden');
    card.append(title, settings, body);

    const gen = this.generation;
    const load = async (fresh: boolean) => {
      reload.disabled = true;
      try {
        const res = (await (fresh ? RefreshWidget : WidgetData)(ws.id, index)) as Result;
        if (gen !== this.generation) return;
        if (res.error) body.replaceChildren(h('p', 'error small', res.error));
        else body.replaceChildren(renderData(res.type, res.data));
        (title.querySelector('.w-when') as HTMLElement).textContent = new Date().toLocaleTimeString('ko-KR', {
          hour: '2-digit',
          minute: '2-digit',
        });
        this.maybeAlert(res);
      } catch (err) {
        if (gen === this.generation) body.replaceChildren(h('p', 'error small', String(err)));
      } finally {
        reload.disabled = false;
      }
    };
    reload.addEventListener('click', () => void load(true));
    gear.addEventListener('click', () => {
      settings.classList.toggle('hidden');
      if (!settings.classList.contains('hidden')) settings.replaceChildren(this.settingsForm(ws, inst, index));
    });
    void load(false);
    return card;
  }

  /** Toasts once per limit window when Claude usage crosses the alert line. */
  private maybeAlert(res: Result) {
    if (res.type !== 'claude-usage' || !res.data) return;
    const d = res.data as ClaudeUsageData;
    for (const w of d.usage.windows ?? []) {
      const key = `${w.key}@${w.resetsAt}`;
      if (w.percent >= d.alertPercent && !this.alerted.has(key)) {
        this.alerted.add(key);
        this.toast(`Claude ${w.label} 한도 ${Math.round(w.percent)}% 사용 — 리셋 전까지 아껴 쓰세요`);
      }
    }
  }

  private settingsForm(ws: Workspace, inst: Instance, index: number): HTMLElement {
    const def = this.def(inst.type)!;
    const form = h('form', 'w-form');
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    for (const spec of def.settings) {
      const current = inst.settings?.[spec.key] ?? spec.default;
      const id = `ws-${index}-${spec.key}`;
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
    const save = h('button', 'primary', '저장');
    save.type = 'submit';
    form.append(save);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
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
      const widgets = ws.widgets.map((w, i) => (i === index ? { ...w, settings: next } : w));
      void this.saveWidgets(widgets);
    });
    return form;
  }

  private manager(ws: Workspace): HTMLElement {
    const list = h('div', 'w-manager');
    list.append(h('p', 'muted small', '이 워크스페이스에서 볼 위젯을 고르세요.'));
    for (const def of this.catalog) {
      const index = ws.widgets.findIndex((w) => w.type === def.id);
      const row = h('label', 'w-manage-row');
      const box = h('input');
      box.type = 'checkbox';
      box.checked = index >= 0 && ws.widgets[index].enabled;
      box.addEventListener('change', () => {
        const widgets =
          index >= 0
            ? ws.widgets.map((w, i) => (i === index ? { ...w, enabled: box.checked } : w))
            : [...ws.widgets, { type: def.id, enabled: box.checked, settings: {} }];
        void this.saveWidgets(widgets);
      });
      const text = h('span', '');
      text.append(h('strong', '', def.name), h('span', 'muted small-inline', ` ${def.description}`));
      row.append(box, text);
      list.append(row);
    }
    return list;
  }
}
