import { h, link, type OpenURL } from './renderers';

/** Things a widget can do besides showing data. */
export interface WidgetActions {
  startQA(feature: string, mode: string): void;
  resume(sessionId: string): void;
}

interface WorktreesData {
  baseRef: string;
  items: Array<{ path: string; branch: string; ahead: number; behind: number; dirty: number; error?: string; stale: boolean; detached: boolean }>;
  errors: string[];
}

interface DeployData {
  rows: Array<{
    name: string;
    state: string;
    waitingDays: number;
    stale: boolean;
    staging?: { number: number; title: string; url: string };
    live?: { number: number; title: string; url: string };
    note?: string;
  }>;
  pending: number;
  unknown: number;
  truncated?: boolean;
  text?: string;
  exitCode: number;
}

interface LinearData {
  issues: Array<{ id: string; title: string; state: string; team: string; url: string; priority: string }>;
  fetchedAt: string;
  costUsd: number;
}

interface NotionData {
  pages: Array<{ id: string; title: string; url: string; version: string; lastEdited: string }>;
  fetchedAt: string;
  costUsd: number;
}

interface QAData {
  domain: string;
  features: string[];
  modes: string[];
  reports: Array<{ name: string; path: string; modified: string }>;
}

interface SessionsData {
  recent: Array<{ sessionId: string; title: string; lastActive: string; open: boolean }>;
  resumeClaude: boolean;
}

const MAX_WORKTREES = 40;

const lastSeg = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

function dateText(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function costNote(fetchedAt: string, cost: number): HTMLElement {
  const usd = cost > 0 ? ` · 약 $${cost.toFixed(3)}` : '';
  return h('p', 'muted small', `${dateText(fetchedAt)} 에 Claude 커넥터로 가져옴 (30분 캐시${usd})`);
}

export function renderWorktrees(d: WorktreesData): HTMLElement {
  const box = h('div', 'w-list');
  const stale = d.items.filter((w) => w.stale).length;
  box.append(h('div', 'w-summary', `기준 ${d.baseRef} · ${d.items.length}개${stale ? ` · 낡음 ${stale}` : ''}`));
  // Items come most-behind first; long lists (hundreds of old worktrees) are cut.
  for (const wt of d.items.slice(0, MAX_WORKTREES)) {
    const item = h('div', wt.stale || wt.error ? 'w-item attention' : 'w-item');
    const title = h('div', 'w-pr-title');
    title.append(h('strong', '', wt.branch || '(detached)'), h('span', 'muted small-inline', lastSeg(wt.path)));
    item.title = wt.path;
    const meta = h('div', 'w-meta');
    if (wt.error) meta.append(h('span', 'w-chip danger', wt.error));
    else {
      meta.append(h('span', wt.stale ? 'w-chip danger' : 'w-chip muted', `↓${wt.behind}`), h('span', 'w-chip muted', `↑${wt.ahead}`));
      if (wt.dirty) meta.append(h('span', 'w-chip warn', `변경 ${wt.dirty}`));
      if (wt.stale) meta.append(h('span', 'w-chip danger', '낡음 — 기준 브랜치 반영 필요'));
    }
    item.append(title, meta);
    box.append(item);
  }
  if (d.items.length > MAX_WORKTREES) box.append(h('p', 'muted small', `… 외 ${d.items.length - MAX_WORKTREES}개`));
  for (const e of d.errors) box.append(h('p', 'error small', e));
  return box;
}

export function renderDeploy(d: DeployData, open: OpenURL): HTMLElement {
  const box = h('div', 'w-list');
  if (d.truncated) box.append(h('p', 'warn small', '출력이 너무 길어 앞부분만 보여 줍니다.'));
  if (d.text !== undefined && d.text !== '' && !d.rows.length) {
    box.append(h('pre', 'w-json', d.text));
    if (d.exitCode) box.append(h('p', 'error small', `종료 코드 ${d.exitCode}`));
    return box;
  }
  box.append(h('div', 'w-summary', `스왑 대기 ${d.pending}건${d.unknown ? ` · 확인 불가 ${d.unknown}` : ''}`));
  for (const r of d.rows) {
    const pending = r.state === 'pending';
    const item = h('div', r.stale ? 'w-item attention' : 'w-item');
    const title = h('div', 'w-pr-title');
    title.append(h('strong', '', r.name), h('span', pending ? 'w-chip warn' : 'w-chip ok', pending ? `스왑 대기 ${r.waitingDays.toFixed(1)}일` : '반영됨'));
    const meta = h('div', 'w-meta');
    if (r.staging) meta.append(h('span', 'muted', 'staging'), link(`#${r.staging.number}`, r.staging.url, open));
    if (r.live) meta.append(h('span', 'muted', 'live'), link(`#${r.live.number}`, r.live.url, open));
    if (r.note) meta.append(h('span', 'muted small-inline', r.note));
    item.append(title, meta);
    box.append(item);
  }
  return box;
}

export function renderLinear(d: LinearData, open: OpenURL): HTMLElement {
  const box = h('div', 'w-list');
  const issues = d.issues ?? [];
  if (!issues.length) box.append(h('p', 'muted small', '진행 중인 내 이슈가 없습니다.'));
  for (const is of issues) {
    const item = h('div', 'w-item');
    const title = h('div', 'w-pr-title');
    title.append(is.url ? link(is.id, is.url, open, 'w-link w-pr-num') : h('span', 'w-pr-num', is.id), h('span', 'w-pr-text', is.title));
    const meta = h('div', 'w-meta');
    meta.append(h('span', 'w-chip muted', is.state));
    if (is.priority) meta.append(h('span', /urgent|high/i.test(is.priority) ? 'w-chip warn' : 'w-chip muted', is.priority));
    item.append(title, meta);
    box.append(item);
  }
  box.append(costNote(d.fetchedAt, d.costUsd));
  return box;
}

export function renderNotion(d: NotionData, open: OpenURL): HTMLElement {
  const box = h('div', 'w-list');
  for (const p of d.pages ?? []) {
    const item = h('div', 'w-item');
    const title = h('div', 'w-pr-title');
    title.append(p.url ? link(p.title || p.id, p.url, open, 'w-link') : h('span', '', p.title || p.id));
    const meta = h('div', 'w-meta');
    if (p.version) meta.append(h('span', 'w-chip ok', p.version));
    if (p.lastEdited) meta.append(h('span', 'muted', `수정 ${dateText(p.lastEdited) || p.lastEdited}`));
    item.append(title, meta);
    box.append(item);
  }
  box.append(costNote(d.fetchedAt, d.costUsd));
  return box;
}

export function renderQA(d: QAData, actions?: WidgetActions): HTMLElement {
  const box = h('div', 'w-list');
  box.append(h('div', 'w-summary', d.domain ? `도메인 ${d.domain}` : '도메인 미설정'));
  if (!d.features.length) box.append(h('p', 'muted small', '⚙ 설정에서 기능(예: 근태, 휴가)을 추가하세요.'));
  for (const f of d.features) {
    const row = h('div', 'w-item');
    const btns = h('div', 'w-meta');
    for (const m of d.modes) {
      const b = h('button', 'ghost small-btn', m);
      b.type = 'button';
      b.title = `/qa-2pass ${d.domain} ${f} ${m}`;
      b.disabled = !actions;
      b.addEventListener('click', () => actions?.startQA(f, m));
      btns.append(b);
    }
    row.append(h('strong', '', f), btns);
    box.append(row);
  }
  if (d.reports.length) {
    box.append(h('div', 'w-summary', '최근 보고서'));
    for (const r of d.reports) {
      const item = h('div', 'w-meta');
      item.title = r.path;
      item.append(h('span', '', r.name), h('span', 'muted', dateText(r.modified)));
      box.append(item);
    }
  }
  return box;
}

export function renderSessions(d: SessionsData, actions?: WidgetActions): HTMLElement {
  const box = h('div', 'w-list');
  const recent = d.recent ?? [];
  if (!recent.length) box.append(h('p', 'muted small', '아직 이어갈 Claude 세션이 없습니다.'));
  for (const s of recent) {
    const item = h('div', 'w-item');
    const title = h('div', 'w-pr-title');
    title.append(h('span', 'w-pr-text', s.title));
    const meta = h('div', 'w-meta');
    meta.append(h('span', 'muted', dateText(s.lastActive)));
    if (s.open) meta.append(h('span', 'w-chip ok', '실행 중'));
    else {
      const b = h('button', 'ghost small-btn', '이어서');
      b.type = 'button';
      b.disabled = !actions;
      b.addEventListener('click', () => actions?.resume(s.sessionId));
      meta.append(b);
    }
    item.append(title, meta);
    box.append(item);
  }
  box.append(h('p', 'muted small', d.resumeClaude ? '앱을 다시 켜면 열려 있던 세션을 자동으로 이어갑니다.' : '자동 이어가기 꺼짐'));
  return box;
}

interface CommandData {
  text: string;
  exitCode: number;
  truncated: boolean;
}

interface LinksData {
  links: Array<{ name: string; url: string }> | null;
  invalid: string[] | null;
}

interface LinearInboxData {
  notifications: Array<{ id: string; kind: string; title: string; actor: string; createdAt: string; read: boolean; url: string }> | null;
  unread: number;
  fetchedAt: string;
  costUsd: number;
}

const KIND_LABEL: Record<string, string> = {
  mention: '멘션',
  assigned: '배정',
  comment: '댓글',
  status: '상태',
  review: '리뷰',
};

export function renderCommand(d: CommandData): HTMLElement {
  const box = h('div', 'w-list');
  box.append(h('pre', 'w-json', d.text || '(출력 없음)'));
  if (d.exitCode) box.append(h('p', 'error small', `종료 코드 ${d.exitCode}`));
  return box;
}

export function renderLinks(d: LinksData, open: OpenURL): HTMLElement {
  const box = h('div', 'w-links');
  const links = d.links ?? [];
  if (!links.length) box.append(h('p', 'muted small', '「설정」에서 이름=https://… 형식으로 링크를 넣으세요.'));
  for (const l of links) box.append(link(l.name, l.url, open, 'ghost small-btn'));
  for (const bad of d.invalid ?? []) box.append(h('p', 'warn small', `형식이 맞지 않아 뺐습니다: ${bad}`));
  return box;
}

export function renderLinearInbox(d: LinearInboxData, open: OpenURL): HTMLElement {
  const box = h('div', 'w-list');
  const items = d.notifications ?? [];
  box.append(h('div', 'w-summary', `안 읽음 ${d.unread} · ${items.length}건`));
  if (!items.length) box.append(h('p', 'muted small', '새 알림이 없습니다.'));
  for (const n of items) {
    const item = h('div', n.read ? 'w-item' : 'w-item attention');
    const title = h('div', 'w-pr-title');
    title.append(h('span', 'w-chip muted', KIND_LABEL[n.kind] ?? n.kind), n.url ? link(n.title, n.url, open, 'w-link w-pr-text') : h('span', 'w-pr-text', n.title));
    const meta = h('div', 'w-meta');
    meta.append(h('span', 'muted', n.actor), h('span', 'muted', dateText(n.createdAt)));
    item.append(title, meta);
    box.append(item);
  }
  box.append(costNote(d.fetchedAt, d.costUsd));
  return box;
}

/** Renderers for local / Claude-connector widgets; null when the type is not one of them. */
export function renderLocal(type: string, data: unknown, open: OpenURL, actions?: WidgetActions): HTMLElement | null {
  switch (type) {
    case 'worktrees':
      return renderWorktrees(data as WorktreesData);
    case 'deploy-swap':
      return renderDeploy(data as DeployData, open);
    case 'linear-issues':
      return renderLinear(data as LinearData, open);
    case 'notion-specs':
      return renderNotion(data as NotionData, open);
    case 'qa-2pass':
      return renderQA(data as QAData, actions);
    case 'session-restore':
      return renderSessions(data as SessionsData, actions);
    case 'command':
      return renderCommand(data as CommandData);
    case 'links':
      return renderLinks(data as LinksData, open);
    case 'linear-inbox':
      return renderLinearInbox(data as LinearInboxData, open);
    default:
      return null;
  }
}
