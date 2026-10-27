/** Feeds the office the Claude usage limits and session token counts. */
import { ClaudeStatus, OfficeTokens } from '../../wailsjs/go/main/App';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import type { OfficeUsage } from './vibe';

/** How often the usage limits are re-read (the backend caches them for a minute). */
const USAGE_EVERY_MS = 2 * 60_000;

interface TokenEvent {
  termId: string;
  tokens: number;
  today: number;
  week: number;
}

interface UsageStatus {
  usage?: { windows?: Array<{ key: string; percent: number }> | null };
  usageError?: string;
}

/**
 * The 5-hour and 7-day percentages, or null when the status could not be
 * read (offline, rate limited): the office then keeps what it last knew.
 * A window the API leaves out has no usage yet, i.e. it just reset.
 */
export function usageFromStatus(d: UsageStatus | null | undefined): OfficeUsage | null {
  if (!d || d.usageError || !d.usage) return null;
  const windows = d.usage.windows ?? [];
  const pct = (key: string) => windows.find((w) => w.key === key)?.percent ?? 0;
  return { fiveHour: pct('five_hour'), sevenDay: pct('seven_day') };
}

export interface OfficeSink {
  setUsage(u: OfficeUsage): void;
  setTokens(termId: string, tokens: number): void;
  setWeekTokens(week: number): void;
}

/** Starts the feeds; returns a function that stops them. */
export function connectOfficeFeeds(office: OfficeSink): () => void {
  let stopped = false; // replies arriving after stop() are dropped
  const loadUsage = () =>
    ClaudeStatus()
      .then((d) => {
        const usage = usageFromStatus(d as unknown as UsageStatus);
        if (usage && !stopped) office.setUsage(usage);
      })
      // Decorative: without usage the office keeps its last look.
      .catch(() => {});
  loadUsage();
  const timer = window.setInterval(loadUsage, USAGE_EVERY_MS);
  OfficeTokens()
    .then((t) => {
      if (!stopped) office.setWeekTokens(t.week);
    })
    .catch(() => {});
  const off = EventsOn('agent:tokens', (ev: TokenEvent) => {
    office.setTokens(ev.termId, ev.tokens);
    office.setWeekTokens(ev.week);
  });
  return () => {
    stopped = true;
    window.clearInterval(timer);
    off();
  };
}
