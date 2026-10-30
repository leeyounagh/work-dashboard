import { dayKey, emptyDay, parseDay, type DayRecord } from './fun';

const DAY_KEY = 'office-day';

/** Today's achievements, kept across restarts (the browser storage may be unavailable). */
export function loadDay(): DayRecord {
  const today = dayKey(new Date());
  try {
    return parseDay(localStorage.getItem(DAY_KEY), today);
  } catch {
    return emptyDay(today);
  }
}

export function saveDay(day: DayRecord): void {
  try {
    localStorage.setItem(DAY_KEY, JSON.stringify(day));
  } catch {
    // Only today's badges are lost.
  }
}
