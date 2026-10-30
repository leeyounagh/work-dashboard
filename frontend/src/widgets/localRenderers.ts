import { h, link, type OpenURL } from './renderers';
import { searchableList } from './search';
import { renderTodo, type TodoActions, type TodoItem } from './todo';

/** Things a widget can do besides showing data. */
export interface WidgetActions {
  startQA(feature: string, mode: string): void;
  resume(sessionId: string): void;
  /** Opens a file listed by this folder widget with its default app. */
  openFile?(name: string): void;
  /** Edits this workspace's to-do list. */
  todo?: TodoActions;
}

interface FolderFilesData {
  folder: string;
  files: Array<{ name: string; modified: string; size: number }> | null;
  total: number;
  limit: number;
}

export function renderFolderFiles(d: FolderFilesData, actions?: WidgetActions): HTMLElement {
  const files = d.files ?? [];
  if (!files.length) return h('p', 'muted small', '이 폴더에 보여 줄 문서가 없습니다.');
  return searchableList({
    key: `folder:${d.folder}`,
    items: files,
    text: (f) => f.name,
    limit: d.limit || 20,
    placeholder: '문서 이름 검색 (여러 단어는 모두 포함)',
    row: (f) => {
      const row = h('div', 'w-meta');
      const name = h('button', 'w-file w-link', f.name);
      name.type = 'button';
      name.title = `${d.folder}\\${f.name} — 누르면 기본 앱으로 엽니다`;
      name.disabled = !actions?.openFile;
      name.addEventListener('click', () => actions?.openFile?.(f.name));
      row.append(name, h('span', 'muted', dateText(f.modified)));
      return row;
    },
  });
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
  issues: Array<{ id: string; title: string; state: string; group?: string; team: string; url: string; priority: string }> | null;
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

const LINEAR_GROUP: Record<string, string> = { todo: '할 일', doing: '진행 중', review: '리뷰·확인 중' };

export function renderLinear(d: LinearData, open: OpenURL): HTMLElement {
  const box = h('div', 'w-list');
  const issues = d.issues ?? [];
  if (!issues.length) box.append(h('p', 'muted small', '진행 중인 내 이슈가 없습니다.'));
  let section = '';
  for (const is of issues) {
    // The backend sorts by group: what I have to do, doing, waiting on review/test.
    const group = is.group ?? '';
    if (group && group !== section) {
      section = group;
      const count = issues.filter((x) => x.group === group).length;
      box.append(h('h4', 'w-section', `${LINEAR_GROUP[group] ?? group} ${count}`));
    }
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
  box.append(
    searchableList({
      key: 'notion-specs',
      items: d.pages ?? [],
      text: (p) => `${p.title} ${p.version ?? ''}`,
      placeholder: '명세 제목 검색',
      row: (p) => {
        const item = h('div', 'w-item');
        const title = h('div', 'w-pr-title');
        title.append(p.url ? link(p.title || p.id, p.url, open, 'w-link') : h('span', '', p.title || p.id));
        const meta = h('div', 'w-meta');
        if (p.version) meta.append(h('span', 'w-chip ok', p.version));
        if (p.lastEdited) meta.append(h('span', 'muted', `수정 ${dateText(p.lastEdited) || p.lastEdited}`));
        item.append(title, meta);
        return item;
      },
    }),
    costNote(d.fetchedAt, d.costUsd),
  );
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
    box.append(
      h('h4', 'w-section', '최근 보고서'),
      searchableList({
        key: `qa-reports:${d.domain}`,
        items: d.reports,
        text: (r) => r.name,
        placeholder: '보고서 검색',
        row: (r) => {
          const item = h('div', 'w-meta');
          item.title = r.path;
          item.append(h('span', '', r.name), h('span', 'muted', dateText(r.modified)));
          return item;
        },
      }),
    );
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

interface TeamsPR {
  number: number;
  title: string;
  author: string;
  url: string;
  shared: boolean;
}

interface TeamsDeployData {
  cards: Array<{ id: string; createdAt: string; webUrl: string; status: string; tag: string; env: string; image: string; prs: TeamsPR[] | null }> | null;
  tags: string[] | null;
  me: string;
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

function teamsPRRow(p: TeamsPR, mine: boolean, open: OpenURL): HTMLElement {
  const row = h('div', 'w-pr-title');
  row.append(p.url ? link(`#${p.number}`, p.url, open, 'w-link w-pr-num') : h('span', 'w-pr-num', `#${p.number}`));
  const title = h('span', 'w-pr-text', p.title);
  title.title = p.title;
  row.append(title, h('span', mine ? 'w-chip ok' : 'muted small-inline', mine ? '내 PR' : p.author));
  return row;
}

/** Deploy cards from a Teams chat, newest first: the service's own PRs, shared-code redeploys only counted. */
export function renderTeamsDeploy(d: TeamsDeployData, open: OpenURL): HTMLElement {
  const box = h('div', 'w-list');
  const cards = d.cards ?? [];
  const me = d.me.toLowerCase();
  const isMine = (p: TeamsPR) => !!me && !p.shared && p.author.toLowerCase() === me;
  box.append(h('div', 'w-summary', `${(d.tags ?? []).join(', ') || '전체 서비스'} · ${cards.length}건`));
  if (!cards.length) box.append(h('p', 'muted small', '최근 배포 알림이 없습니다.'));
  for (const c of cards) {
    const prs = c.prs ?? [];
    const item = h('div', c.status === '✅' ? 'w-item' : 'w-item attention');
    const head = h('div', 'w-pr-title');
    head.append(h('span', c.env === 'PROD' ? 'w-chip warn' : 'w-chip', c.env), h('span', 'w-chip muted', c.tag));
    head.append(h('span', 'w-pr-text', `${c.status} ${c.image ? `이미지 ${c.image}` : '배포'}`));
    if (prs.some(isMine)) head.append(h('span', 'w-chip ok', '내 PR 포함'));
    const meta = h('div', 'w-meta');
    meta.append(h('span', 'muted', dateText(c.createdAt)));
    if (c.webUrl) meta.append(link('Teams 원본', c.webUrl, open));
    item.append(head, meta);
    for (const p of prs.filter((p) => !p.shared)) item.append(teamsPRRow(p, isMine(p), open));
    const shared = prs.filter((p) => p.shared).length;
    if (shared) item.append(h('p', 'muted small', `공유 코드로 함께 재배포된 PR ${shared}건`));
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
    case 'teams-deploy':
      return renderTeamsDeploy(data as TeamsDeployData, open);
    case 'folder-files':
      return renderFolderFiles(data as FolderFilesData, actions);
    case 'todo':
      return renderTodo(data as { items: TodoItem[] | null }, actions?.todo);
    default:
      return null;
  }
}
