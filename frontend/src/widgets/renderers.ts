/** Turns widget data from the backend into DOM. Text only goes through textContent. */

export type OpenURL = (url: string) => void;

interface PRRef {
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  draft: boolean;
  base: string;
  since: string;
}

interface Reviewer {
  login: string;
  state: string;
  rerequested?: boolean;
}

export interface PRReviewsData {
  items: Array<PRRef & { reviewers: Reviewer[] | null; approvals: number; highlights: string[]; checks: string }>;
  summary: { total: number; noReview: number; changesRequested: number; needsApproval: number };
}

export interface CIFailuresData {
  items: Array<PRRef & { failed: Array<{ name: string; url: string }>; running: number }>;
}

export interface ReviewQueueData {
  items: Array<PRRef & { waitingHours: number; stale: boolean }>;
  staleCount: number;
}

export interface ClaudeUsageData {
  login: {
    loggedIn: boolean;
    email: string;
    displayName: string;
    organization: string;
    role: string;
    subscription: string;
    rateLimitTier: string;
    tokenExpiresAt: string;
  };
  usage: { windows: Array<{ key: string; label: string; percent: number; resetsAt: string }> | null };
  usageError?: string;
  alertPercent: number;
  alert: boolean;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

/** A link that opens in the system browser; only http(s) URLs are allowed. */
export function link(text: string, url: string, open: OpenURL, className = 'w-link'): HTMLElement {
  const a = h('button', className, text);
  a.type = 'button';
  a.title = url;
  if (/^https?:\/\//i.test(url)) a.addEventListener('click', () => open(url));
  else a.disabled = true;
  return a;
}

/** "3시간" / "2일" from hours. */
export function hoursText(hours: number): string {
  if (hours < 1) return '1시간 미만';
  if (hours < 48) return `${hours}시간`;
  return `${Math.floor(hours / 24)}일`;
}

/** Time until an ISO timestamp, e.g. "2시간 14분 후". */
export function untilText(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return '곧 리셋';
  const mins = Math.round(ms / 60000);
  const d = Math.floor(mins / 1440);
  const hh = Math.floor((mins % 1440) / 60);
  const mm = mins % 60;
  if (d > 0) return `${d}일 ${hh}시간 후 리셋`;
  if (hh > 0) return `${hh}시간 ${mm}분 후 리셋`;
  return `${mm}분 후 리셋`;
}

const HIGHLIGHT_LABEL: Record<string, string> = {
  'no-review': '리뷰 0회',
  'changes-requested': '변경 요청',
  'needs-approval': '승인 부족',
};

const REVIEW_STATE: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: '승인', cls: 'ok' },
  CHANGES_REQUESTED: { label: '변경 요청', cls: 'danger' },
  COMMENTED: { label: '코멘트', cls: 'muted' },
  DISMISSED: { label: '철회됨', cls: 'muted' },
  PENDING: { label: '대기', cls: 'warn' },
};

function prTitle(pr: PRRef, open: OpenURL): HTMLElement {
  const row = h('div', 'w-pr-title');
  row.append(link(`${pr.repo.split('/').pop()}#${pr.number}`, pr.url, open, 'w-link w-pr-num'), h('span', 'w-pr-text', pr.title));
  if (pr.draft) row.append(h('span', 'w-chip muted', 'draft'));
  return row;
}

function empty(text: string): HTMLElement {
  return h('p', 'muted small', text);
}

export function renderPRReviews(d: PRReviewsData, open: OpenURL): HTMLElement {
  const box = h('div', 'w-list');
  const s = d.summary;
  const summary = h('div', 'w-summary');
  summary.append(
    h('span', '', `${s.total}건`),
    ...(s.noReview ? [h('span', 'w-chip warn', `리뷰 0회 ${s.noReview}`)] : []),
    ...(s.changesRequested ? [h('span', 'w-chip danger', `변경 요청 ${s.changesRequested}`)] : []),
    ...(s.needsApproval ? [h('span', 'w-chip muted', `승인 부족 ${s.needsApproval}`)] : []),
  );
  box.append(summary);
  if (!d.items.length) box.append(empty('열린 PR 이 없습니다.'));
  for (const pr of d.items) {
    const item = h('div', pr.highlights.length ? 'w-item attention' : 'w-item');
    item.append(prTitle(pr, open));
    const meta = h('div', 'w-meta');
    for (const hl of pr.highlights) meta.append(h('span', `w-chip ${hl === 'changes-requested' ? 'danger' : 'warn'}`, HIGHLIGHT_LABEL[hl] ?? hl));
    for (const r of pr.reviewers ?? []) {
      const st = REVIEW_STATE[r.state] ?? { label: r.state, cls: 'muted' };
      const again = r.rerequested ? ' → 재요청' : '';
      meta.append(h('span', `w-reviewer ${r.rerequested ? 'warn' : st.cls}`, `${r.login} · ${st.label}${again}`));
    }
    if (pr.checks === 'FAILURE' || pr.checks === 'ERROR') meta.append(h('span', 'w-chip danger', 'CI 실패'));
    item.append(meta);
    box.append(item);
  }
  return box;
}

export function renderCIFailures(d: CIFailuresData, open: OpenURL): HTMLElement {
  const box = h('div', 'w-list');
  if (!d.items.length) box.append(empty('CI 가 실패한 PR 이 없습니다. 👍'));
  for (const pr of d.items) {
    const item = h('div', 'w-item attention');
    item.append(prTitle(pr, open));
    const meta = h('div', 'w-meta');
    for (const c of pr.failed) meta.append(link(`✗ ${c.name}`, c.url, open, 'w-link danger'));
    if (pr.running) meta.append(h('span', 'w-chip muted', `실행 중 ${pr.running}`));
    item.append(meta);
    box.append(item);
  }
  return box;
}

export function renderReviewQueue(d: ReviewQueueData, open: OpenURL): HTMLElement {
  const box = h('div', 'w-list');
  if (d.staleCount) box.append(h('div', 'w-summary', `오래 기다린 요청 ${d.staleCount}건`));
  if (!d.items.length) box.append(empty('나에게 온 리뷰 요청이 없습니다.'));
  for (const pr of d.items) {
    const item = h('div', pr.stale ? 'w-item attention' : 'w-item');
    item.append(prTitle(pr, open));
    const meta = h('div', 'w-meta');
    meta.append(h('span', '', pr.author), h('span', pr.stale ? 'w-chip warn' : 'w-chip muted', `${hoursText(pr.waitingHours)} 대기`));
    item.append(meta);
    box.append(item);
  }
  return box;
}

export function renderClaudeUsage(d: ClaudeUsageData, now = Date.now()): HTMLElement {
  const box = h('div', 'w-claude');
  for (const w of d.usage.windows ?? []) {
    const row = h('div', 'w-usage');
    const pct = Math.max(0, Math.min(100, w.percent));
    const level = pct >= d.alertPercent ? 'danger' : pct >= d.alertPercent - 20 ? 'warn' : 'ok';
    const head = h('div', 'w-usage-head');
    head.append(h('span', '', w.label), h('span', `w-usage-pct ${level}`, `${Math.round(pct)}%`));
    const bar = h('div', 'w-bar');
    const fill = h('div', `w-bar-fill ${level}`);
    fill.style.width = `${pct}%`;
    bar.append(fill);
    row.append(head, bar, h('div', 'muted small-inline', untilText(w.resetsAt, now)));
    box.append(row);
  }
  if (d.usageError) box.append(h('p', 'error small', d.usageError));

  const l = d.login;
  const acct = h('dl', 'w-account');
  const add = (k: string, v: string) => {
    if (!v) return;
    acct.append(h('dt', '', k), h('dd', '', v));
  };
  if (l.loggedIn) {
    add('계정', l.email);
    add('조직', l.organization ? `${l.organization}${l.role ? ` · ${l.role}` : ''}` : '');
    add('플랜', [l.subscription, l.rateLimitTier.replace(/^default_claude_/, '')].filter(Boolean).join(' · '));
    const exp = Date.parse(l.tokenExpiresAt);
    if (Number.isFinite(exp)) add('토큰', exp > now ? untilText(l.tokenExpiresAt, now).replace('리셋', '만료') : '만료됨 (Claude Code 실행 시 갱신)');
  } else {
    add('계정', '로그인 안 됨');
  }
  box.append(acct);
  return box;
}

export function renderPlanned(d: { message: string }): HTMLElement {
  return empty(d.message);
}

/** Fallback for data without a dedicated renderer. */
export function renderJSON(data: unknown): HTMLElement {
  return h('pre', 'w-json', JSON.stringify(data, null, 2));
}
