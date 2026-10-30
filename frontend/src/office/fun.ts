/**
 * Little office events: long waits hop, long work streaks catch fire,
 * finished sessions get a high five, deploys get a banner, the crown flies
 * to a new MVP, and the day's achievements pile up on the wall.
 */
import type { AgentState } from './agentState';

/** Waiting on the user this long, a character hops and shows "!". */
export const WAIT_LONG_MS = 60_000;

export const waitingLong = (s: AgentState, alive: boolean, now: number) => alive && s.mood === 'waiting' && now - s.since >= WAIT_LONG_MS;

/** Two quick hops, then a pause: the height in px at a time. */
export function hopOffset(now: number): number {
  const t = (((now % 1200) + 1200) % 1200) / 1200;
  return t < 0.5 ? Math.round(Math.abs(Math.sin(t * 4 * Math.PI)) * 6) : 0;
}

/** A work streak ends after this long idle (short pauses between prompts do not count). */
export const STREAK_BREAK_MS = 3 * 60_000;

export interface Streak {
  since: number | null; // when the streak started
  idleAt: number | null; // when the current pause started
}

export const NO_STREAK: Streak = { since: null, idleAt: null };

export function nextStreak(s: Streak, busy: boolean, now: number): Streak {
  if (busy) return s.since !== null && s.idleAt === null ? s : { since: s.since ?? now, idleAt: null };
  if (s.since === null) return s;
  const idleAt = s.idleAt ?? now;
  if (now - idleAt >= STREAK_BREAK_MS) return NO_STREAK;
  return s.idleAt === idleAt ? s : { since: s.since, idleAt };
}

/** Flame size: 30 minutes of work lights it, an hour and two hours grow it. */
export function streakLevel(s: Streak, now: number): 0 | 1 | 2 | 3 {
  if (s.since === null) return 0;
  const min = (now - s.since) / 60_000;
  return min >= 120 ? 3 : min >= 60 ? 2 : min >= 30 ? 1 : 0;
}

/** How long a high five shows once the two meet, and how long the partner may take to arrive. */
export const HIGH_FIVE_MS = 1500;
export const HIGH_FIVE_WALK_MS = 6000;
/** Close enough to clap. */
export const HIGH_FIVE_REACH = 40;

/** The nearest idle character that can walk over, or null. */
export function pickHighFive<T extends { id: string; x: number; y: number; idle: boolean }>(finisher: T, others: T[]): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const o of others) {
    if (o.id === finisher.id || !o.idle) continue;
    const d = Math.hypot(o.x - finisher.x, o.y - finisher.y);
    if (d < bestDist) {
      best = o;
      bestDist = d;
    }
  }
  return best;
}

/** The crown's flight from the old MVP to the new one. */
export const CROWN_FLIGHT_MS = 1200;

export function crownFlight(from: { x: number; y: number }, to: { x: number; y: number }, t: number): { x: number; y: number } {
  const k = Math.min(1, Math.max(0, t));
  const ease = k * k * (3 - 2 * k);
  return { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease - Math.sin(Math.PI * k) * 40 };
}

/** A deploy card from the Teams deploy widget. */
export interface DeployCard {
  id: string;
  createdAt: string;
  status: string;
  tag: string;
  env: string;
  prs: Array<{ author: string; shared: boolean }> | null;
}

const MAX_LABEL = 24;
const str = (v: unknown): v is string => typeof v === 'string';

/** Cards from the widget's (untrusted) data: malformed ones and PR entries are dropped. */
export function toDeployCards(raw: unknown): DeployCard[] {
  if (!Array.isArray(raw)) return [];
  const cards: DeployCard[] = [];
  for (const c of raw as Array<Record<string, unknown>>) {
    if (!c || !str(c.id) || !str(c.createdAt) || !str(c.status) || !str(c.tag) || !str(c.env)) continue;
    const prs = Array.isArray(c.prs) ? (c.prs as Array<Record<string, unknown>>).filter((p) => p && str(p.author)) : [];
    cards.push({
      id: c.id,
      createdAt: c.createdAt,
      status: c.status,
      tag: c.tag.slice(0, MAX_LABEL),
      env: c.env.slice(0, MAX_LABEL),
      prs: prs.map((p) => ({ author: p.author as string, shared: p.shared === true })),
    });
  }
  return cards;
}

/** Only deploys this recent get a banner (older ones were seen before the app opened). */
export const DEPLOY_FRESH_MS = 15 * 60_000;

export interface DeployCheer {
  id: string;
  text: string;
  mine: boolean; // one of my PRs went out: everyone cheers
}

/** Successful deploys not seen before and posted recently, oldest first. */
export function freshDeploys(cards: DeployCard[], seen: ReadonlySet<string>, me: string, now: number): DeployCheer[] {
  const who = me.toLowerCase();
  return cards
    .filter((c) => !seen.has(c.id) && c.status === '✅' && now - Date.parse(c.createdAt) <= DEPLOY_FRESH_MS)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((c) => ({
      id: c.id,
      text: `🚀 ${c.tag} ${c.env} 배포 완료!`,
      mine: !!who && (c.prs ?? []).some((p) => !p.shared && p.author.toLowerCase() === who),
    }));
}

/** A banner across the wall; one at a time, each for BANNER_MS. */
export const BANNER_MS = 4500;

export interface Banner {
  text: string;
  at: number | null; // when it went up; null while queued
}

/** Drops the banner that is done and starts the next one. */
export function advanceBanners(queue: readonly Banner[], now: number): Banner[] {
  let q = [...queue];
  if (q.length && q[0].at !== null && now - q[0].at >= BANNER_MS) q = q.slice(1);
  if (q.length && q[0].at === null) q = [{ ...q[0], at: now }, ...q.slice(1)];
  return q;
}

/** What the day's achievements are judged on. */
export interface DayStats {
  totalTokens: number; // today's tokens across sessions
  working: number; // sessions working right now
  streak: number; // the longest streak's level
  highFives: number;
  deploys: number;
  quizzes: number;
}

export interface Achievement {
  id: string;
  icon: string;
  name: string;
  earned: (s: DayStats) => boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'million', icon: '💰', name: '오늘 백만 토큰', earned: (s) => s.totalTokens >= 1_000_000 },
  { id: 'multitask', icon: '🤹', name: '멀티태스커 (동시에 3개 세션 작업)', earned: (s) => s.working >= 3 },
  { id: 'marathon', icon: '🏃', name: '마라토너 (1시간 연속 작업)', earned: (s) => s.streak >= 2 },
  { id: 'teamwork', icon: '🙌', name: '팀워크 (하이파이브 5번)', earned: (s) => s.highFives >= 5 },
  { id: 'shipper', icon: '🚀', name: '배포왕 (배포 3번)', earned: (s) => s.deploys >= 3 },
  { id: 'scholar', icon: '🎓', name: '공부왕 (퀴즈 도전)', earned: (s) => s.quizzes >= 1 },
];

export const newlyEarned = (earned: readonly string[], s: DayStats): Achievement[] =>
  ACHIEVEMENTS.filter((a) => !earned.includes(a.id) && a.earned(s));

/** The day's achievements and the counts behind them; a new day starts empty. */
export interface DayRecord {
  day: string;
  earned: string[];
  tokens: number;
  highFives: number;
  deploys: number;
  quizzes: number;
  seen: string[]; // deploy cards already celebrated (a restart does not cheer them again)
}

/** How many celebrated deploy ids a day keeps. */
export const MAX_SEEN = 200;

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const emptyDay = (day: string): DayRecord => ({ day, earned: [], tokens: 0, highFives: 0, deploys: 0, quizzes: 0, seen: [] });

/** A stored record if it is today's and well formed, else a fresh one. */
export function parseDay(raw: string | null, today: string): DayRecord {
  if (!raw) return emptyDay(today);
  try {
    const r = JSON.parse(raw) as Partial<DayRecord>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    if (r.day !== today || !Array.isArray(r.earned)) return emptyDay(today);
    const known = new Set(ACHIEVEMENTS.map((a) => a.id));
    return {
      day: today,
      earned: r.earned.filter((id): id is string => str(id) && known.has(id)),
      tokens: n(r.tokens),
      highFives: n(r.highFives),
      deploys: n(r.deploys),
      quizzes: n(r.quizzes),
      seen: Array.isArray(r.seen) ? r.seen.filter(str).slice(-MAX_SEEN) : [],
    };
  } catch {
    return emptyDay(today);
  }
}
