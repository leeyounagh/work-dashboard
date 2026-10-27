/**
 * How Claude usage changes the office: the light (5-hour limit), the coffee
 * pot, the plants (7-day limit), each desk's clutter (the session's tokens)
 * and the furniture the office earns over the week.
 */

/** Usage limits in percent (null when unknown). */
export interface OfficeUsage {
  fiveHour: number | null;
  sevenDay: number | null;
}

export interface Lighting {
  dark: number; // 0..1 alpha of the night overlay
  lamps: boolean; // desk lamps on ("야근 모드")
}

/** Day below half the 5-hour limit, dusk up to 90%, then night with desk lamps. */
export function lightingFor(fiveHour: number | null): Lighting {
  if (fiveHour === null || fiveHour < 50) return { dark: 0, lamps: false };
  if (fiveHour < 90) return { dark: ((fiveHour - 50) / 40) * 0.4, lamps: false };
  return { dark: 0.55, lamps: true };
}

/** Coffee left in the pot, 1 (full) to 0 (empty at the 5-hour limit). */
export function coffeeLevel(fiveHour: number | null): number {
  if (fiveHour === null) return 1;
  return Math.min(1, Math.max(0, 1 - fiveHour / 100));
}

/** The pot counts as empty a little before 100%, so the queue shows up. */
export const coffeeEmpty = (fiveHour: number | null) => coffeeLevel(fiveHour) <= 0.02;

export type PlantHealth = 'fresh' | 'droopy' | 'wilted';

export function plantHealth(sevenDay: number | null): PlantHealth {
  if (sevenDay === null || sevenDay < 60) return 'fresh';
  return sevenDay < 85 ? 'droopy' : 'wilted';
}

/** A big drop in the 5-hour usage means the window reset: morning comes. */
export function isReset(prev: number | null, next: number | null): boolean {
  return prev !== null && next !== null && prev >= 30 && next <= prev - 25;
}

export const SUNRISE_MS = 12_000;

/** Paper sheets on a desk: one per 10K tokens, at most 8. */
export const paperCount = (tokens: number) => Math.min(8, Math.floor(tokens / 10_000));

/** Coffee cups from 100K tokens: one more every 200K, at most 3. */
export const cupCount = (tokens: number) => (tokens < 100_000 ? 0 : Math.min(3, 1 + Math.floor((tokens - 100_000) / 200_000)));

export const sweating = (tokens: number) => tokens >= 100_000;

export const MILESTONES = [100_000, 500_000, 1_000_000];

/** The highest milestone passed going from prev to next tokens, if any. */
export function crossedMilestone(prev: number, next: number): number | null {
  const passed = MILESTONES.filter((m) => prev < m && next >= m);
  return passed.length ? passed[passed.length - 1] : null;
}

export const CELEBRATE_MS = 6_000;

/** Weekly tokens that earn furniture: a bookshelf, a sofa, an aquarium. */
export const LEVELS = [500_000, 3_000_000, 10_000_000];

export function officeLevel(week: number): number {
  return LEVELS.filter((t) => week >= t).length;
}

/** 950 · 12.3K · 1.2M */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${trim(n / 1000)}K`;
  return `${trim(n / 1_000_000)}M`;
}

const trim = (v: number) => (v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, ''));

/** The terminal that used the most tokens, if any used some. */
export function mvp<T extends { title: string; tokens: number }>(items: T[]): T | null {
  let best: T | null = null;
  for (const it of items) if (it.tokens > 0 && (!best || it.tokens > best.tokens)) best = it;
  return best;
}

/** Confetti pieces: position relative to the origin after elapsed ms. */
export function confetti(elapsed: number, count = 18): Array<{ x: number; y: number; color: string }> {
  const colors = ['#e5c07b', '#73c991', '#d4a27f', '#7aa2f7', '#e06c75'];
  const t = elapsed / 1000;
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + ((i / count) - 0.5) * 2.4;
    const speed = 60 + (i % 5) * 14;
    return {
      x: Math.cos(angle) * speed * t,
      y: Math.sin(angle) * speed * t + 90 * t * t,
      color: colors[i % colors.length],
    };
  });
}
