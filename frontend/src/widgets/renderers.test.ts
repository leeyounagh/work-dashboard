// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  hoursText,
  link,
  renderCIFailures,
  renderClaudeUsage,
  renderPRReviews,
  untilText,
  type ClaudeUsageData,
  type PRReviewsData,
} from './renderers';

const pr = { number: 7, title: '<b>title</b>', url: 'https://github.com/o/r/pull/7', repo: 'o/r', author: 'me', draft: false, base: 'main', since: '' };

describe('renderPRReviews', () => {
  const data: PRReviewsData = {
    items: [{ ...pr, reviewers: [{ login: 'alice', state: 'CHANGES_REQUESTED' }, { login: 'carol', state: 'PENDING' }], approvals: 0, highlights: ['changes-requested'], checks: 'FAILURE' }],
    summary: { total: 1, noReview: 0, changesRequested: 1, needsApproval: 0 },
  };

  it('shows highlights, reviewers and CI state as text', () => {
    const el = renderPRReviews(data, vi.fn());
    const text = el.textContent ?? '';
    expect(text).toContain('변경 요청');
    expect(text).toContain('alice · 변경 요청');
    expect(text).toContain('carol · 대기');
    expect(text).toContain('CI 실패');
    // Titles are text, never HTML.
    expect(el.querySelector('b')).toBeNull();
    expect(text).toContain('<b>title</b>');
  });

  it('opens the PR in the system browser', () => {
    const open = vi.fn();
    renderPRReviews(data, open).querySelector<HTMLButtonElement>('.w-pr-num')!.click();
    expect(open).toHaveBeenCalledWith('https://github.com/o/r/pull/7');
  });

  it('handles null reviewer lists from Go', () => {
    const el = renderPRReviews({ ...data, items: [{ ...data.items[0], reviewers: null }] }, vi.fn());
    expect(el.textContent).toContain('o/r'.split('/')[1]);
  });
});

describe('link', () => {
  it('refuses non-http URLs', () => {
    const open = vi.fn();
    const el = link('x', 'javascript:alert(1)', open) as HTMLButtonElement;
    el.click();
    expect(open).not.toHaveBeenCalled();
    expect(el.disabled).toBe(true);
  });
});

describe('renderCIFailures', () => {
  it('links each failed check', () => {
    const open = vi.fn();
    const el = renderCIFailures({ items: [{ ...pr, failed: [{ name: 'test', url: 'https://ci/test' }], running: 2 }] }, open);
    el.querySelector<HTMLButtonElement>('.danger')!.click();
    expect(open).toHaveBeenCalledWith('https://ci/test');
    expect(el.textContent).toContain('실행 중 2');
  });
});

describe('renderClaudeUsage', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  const data: ClaudeUsageData = {
    login: { loggedIn: true, email: 'me@example.com', displayName: '', organization: 'Acme', role: 'user', subscription: 'team', rateLimitTier: 'default_claude_max_5x', tokenExpiresAt: '2026-10-23T15:00:00Z' },
    usage: { windows: [{ key: 'five_hour', label: '5시간', percent: 92, resetsAt: '2026-10-23T14:14:00Z' }] },
    alertPercent: 90,
    alert: true,
  };

  it('shows usage bars, reset time and account without secrets', () => {
    const el = renderClaudeUsage(data, now);
    expect(el.querySelector('.w-bar-fill.danger')).not.toBeNull();
    expect(el.textContent).toContain('92%');
    expect(el.textContent).toContain('2시간 14분 후 리셋');
    expect(el.textContent).toContain('me@example.com');
    expect(el.textContent).toContain('team · max_5x');
    expect(el.textContent).toContain('3시간 0분 후 만료');
  });

  it('shows a logged-out state', () => {
    const el = renderClaudeUsage({ ...data, login: { ...data.login, loggedIn: false }, usage: { windows: null }, usageError: '로그인 필요' }, now);
    expect(el.textContent).toContain('로그인 안 됨');
    expect(el.textContent).toContain('로그인 필요');
  });
});

describe('time text', () => {
  it('formats waiting hours', () => {
    expect(hoursText(0)).toBe('1시간 미만');
    expect(hoursText(5)).toBe('5시간');
    expect(hoursText(72)).toBe('3일');
  });
  it('formats time until reset', () => {
    const now = Date.parse('2026-10-23T00:00:00Z');
    expect(untilText('2026-10-23T00:30:00Z', now)).toBe('30분 후 리셋');
    expect(untilText('2026-10-25T01:00:00Z', now)).toBe('2일 1시간 후 리셋');
    expect(untilText('2026-10-22T00:00:00Z', now)).toBe('곧 리셋');
    expect(untilText('', now)).toBe('');
  });
});
