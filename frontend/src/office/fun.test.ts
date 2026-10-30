import { describe, expect, it } from 'vitest';
import {
  BANNER_MS,
  DEPLOY_FRESH_MS,
  NO_STREAK,
  STREAK_BREAK_MS,
  WAIT_LONG_MS,
  advanceBanners,
  crownFlight,
  dayKey,
  freshDeploys,
  hopOffset,
  newlyEarned,
  nextStreak,
  parseDay,
  pickHighFive,
  streakLevel,
  toDeployCards,
  waitingLong,
  type DayStats,
  type DeployCard,
} from './fun';

const MIN = 60_000;

describe('long waits', () => {
  it('hop only after a minute of waiting on the user', () => {
    const s = { mood: 'waiting' as const, tool: '', since: 0 };
    expect(waitingLong(s, true, WAIT_LONG_MS - 1)).toBe(false);
    expect(waitingLong(s, true, WAIT_LONG_MS)).toBe(true);
    expect(waitingLong(s, false, WAIT_LONG_MS)).toBe(false);
    expect(waitingLong({ ...s, mood: 'working' }, true, WAIT_LONG_MS)).toBe(false);
  });

  it('hops twice, then rests', () => {
    const heights = Array.from({ length: 24 }, (_, i) => hopOffset(i * 50));
    expect(Math.max(...heights)).toBe(6);
    expect(heights.slice(12).every((h) => h === 0)).toBe(true);
    expect(hopOffset(-300)).toBeGreaterThanOrEqual(0);
  });
});

describe('work streaks', () => {
  it('survive short pauses and end after a long one', () => {
    let s = nextStreak(NO_STREAK, true, 0);
    expect(s.since).toBe(0);
    s = nextStreak(s, false, 31 * MIN); // between prompts
    s = nextStreak(s, true, 32 * MIN);
    expect(streakLevel(s, 32 * MIN)).toBe(1);
    expect(streakLevel(s, 61 * MIN)).toBe(2);
    expect(streakLevel(s, 121 * MIN)).toBe(3);
    s = nextStreak(s, false, 130 * MIN);
    expect(nextStreak(s, false, 130 * MIN + STREAK_BREAK_MS)).toEqual(NO_STREAK);
    expect(streakLevel(NO_STREAK, 0)).toBe(0);
  });

  it('keeps the same object while nothing changes', () => {
    const s = nextStreak(NO_STREAK, true, 0);
    expect(nextStreak(s, true, 10)).toBe(s);
    expect(nextStreak(NO_STREAK, false, 10)).toBe(NO_STREAK);
  });
});

describe('high fives', () => {
  it('picks the nearest idle character other than the finisher', () => {
    const me = { id: 'a', x: 0, y: 0, idle: true };
    const far = { id: 'b', x: 300, y: 0, idle: true };
    const near = { id: 'c', x: 50, y: 0, idle: true };
    const busy = { id: 'd', x: 10, y: 0, idle: false };
    expect(pickHighFive(me, [me, far, near, busy])?.id).toBe('c');
    expect(pickHighFive(me, [me, busy])).toBeNull();
  });
});

describe('crown flight', () => {
  it('starts at the old MVP, arcs up, lands on the new one', () => {
    const from = { x: 0, y: 100 };
    const to = { x: 200, y: 100 };
    expect(crownFlight(from, to, 0)).toEqual(from);
    expect(crownFlight(from, to, 0.5).y).toBeLessThan(100);
    expect(crownFlight(from, to, 1)).toEqual({ x: 200, y: 100 });
    expect(crownFlight(from, to, 2)).toEqual({ x: 200, y: 100 });
  });
});

describe('deploy cheers', () => {
  const now = Date.parse('2026-10-30T05:00:00Z');
  const card = (id: string, minutesAgo: number, extra: Partial<DeployCard> = {}): DeployCard => ({
    id,
    createdAt: new Date(now - minutesAgo * MIN).toISOString(),
    status: '✅',
    tag: 'groupware',
    env: 'TEST',
    prs: [{ author: 'leeyounagh', shared: false }],
    ...extra,
  });

  it('cheers new, recent, successful deploys, oldest first', () => {
    const cards = [card('new', 1), card('older', 5), card('seen', 2), card('old', DEPLOY_FRESH_MS / MIN + 1), card('failed', 1, { status: '❌' })];
    const got = freshDeploys(cards, new Set(['seen']), 'LeeYounagh', now);
    expect(got.map((c) => c.id)).toEqual(['older', 'new']);
    expect(got[0]).toEqual({ id: 'older', text: '🚀 groupware TEST 배포 완료!', mine: true });
  });

  it('is mine only for my own (not shared) PRs', () => {
    const shared = card('s', 1, { prs: [{ author: 'leeyounagh', shared: true }] });
    expect(freshDeploys([shared], new Set(), 'leeyounagh', now)[0].mine).toBe(false);
    expect(freshDeploys([card('x', 1, { prs: null })], new Set(), '', now)[0].mine).toBe(false);
  });
});

describe('deploy card data', () => {
  it('drops malformed cards and PR entries', () => {
    expect(toDeployCards(null)).toEqual([]);
    expect(toDeployCards({ cards: [] })).toEqual([]);
    const got = toDeployCards([
      { id: '1', createdAt: 'x', status: '✅', tag: 'g'.repeat(40), env: 'TEST', prs: [{ author: 'me', shared: 1 }, { title: 'no author' }, null] },
      { id: 2, createdAt: 'x', status: '✅', tag: 't', env: 'TEST' },
      null,
    ]);
    expect(got).toEqual([{ id: '1', createdAt: 'x', status: '✅', tag: 'g'.repeat(24), env: 'TEST', prs: [{ author: 'me', shared: false }] }]);
  });
});

describe('banners', () => {
  it('show one at a time', () => {
    let q = advanceBanners([{ text: 'a', at: null }, { text: 'b', at: null }], 0);
    expect(q[0]).toEqual({ text: 'a', at: 0 });
    q = advanceBanners(q, BANNER_MS - 1);
    expect(q[0].text).toBe('a');
    q = advanceBanners(q, BANNER_MS);
    expect(q).toEqual([{ text: 'b', at: BANNER_MS }]);
    expect(advanceBanners([], 0)).toEqual([]);
  });
});

describe('achievements', () => {
  const stats: DayStats = { totalTokens: 0, working: 0, streak: 0, highFives: 0, deploys: 0, quizzes: 0 };

  it('are earned once', () => {
    expect(newlyEarned([], stats)).toEqual([]);
    const s = { ...stats, totalTokens: 1_200_000, working: 3, quizzes: 1 };
    expect(newlyEarned([], s).map((a) => a.id)).toEqual(['million', 'multitask', 'scholar']);
    expect(newlyEarned(['million', 'multitask'], s).map((a) => a.id)).toEqual(['scholar']);
  });

  it('keep only today’s valid record', () => {
    const today = dayKey(new Date(2026, 9, 30));
    expect(today).toBe('2026-10-30');
    const kept = parseDay(JSON.stringify({ day: today, earned: ['million', 'bogus', 3], highFives: 2, deploys: -1, quizzes: 'x' }), today);
    expect(kept).toEqual({ day: today, earned: ['million'], tokens: 0, highFives: 2, deploys: 0, quizzes: 0, seen: [] });
    const withSeen = parseDay(JSON.stringify({ day: today, earned: [], tokens: 5, seen: ['a', 1, 'b'] }), today);
    expect(withSeen.tokens).toBe(5);
    expect(withSeen.seen).toEqual(['a', 'b']);
    expect(parseDay(JSON.stringify({ day: '2026-10-29', earned: ['million'] }), today).earned).toEqual([]);
    expect(parseDay('{', today).earned).toEqual([]);
    expect(parseDay(null, today).day).toBe(today);
  });
});
