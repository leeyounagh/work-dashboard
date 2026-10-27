// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

const app = vi.hoisted(() => ({ ClaudeStatus: vi.fn(), OfficeTokens: vi.fn() }));
const runtime = vi.hoisted(() => ({ off: vi.fn(), EventsOn: vi.fn() }));
vi.mock('../../wailsjs/go/main/App', () => app);
vi.mock('../../wailsjs/runtime/runtime', () => ({ EventsOn: runtime.EventsOn }));

const { connectOfficeFeeds, usageFromStatus } = await import('./feeds');

describe('usageFromStatus', () => {
  it('reads the 5-hour and 7-day windows', () => {
    const d = { usage: { windows: [{ key: 'seven_day', percent: 61 }, { key: 'five_hour', percent: 12.5 }] } };
    expect(usageFromStatus(d)).toEqual({ fiveHour: 12.5, sevenDay: 61 });
  });

  it('treats a window left out as unused (just reset)', () => {
    expect(usageFromStatus({ usage: { windows: [{ key: 'seven_day', percent: 40 }] } })).toEqual({ fiveHour: 0, sevenDay: 40 });
    expect(usageFromStatus({ usage: { windows: null } })).toEqual({ fiveHour: 0, sevenDay: 0 });
  });

  it('is unknown when the status could not be read', () => {
    expect(usageFromStatus(null)).toBeNull();
    expect(usageFromStatus({ usageError: 'HTTP 429', usage: { windows: [{ key: 'five_hour', percent: 3 }] } })).toBeNull();
  });
});

describe('connectOfficeFeeds', () => {
  const sink = () => ({ setUsage: vi.fn(), setTokens: vi.fn(), setWeekTokens: vi.fn() });

  it('feeds usage, week totals and token events, and keeps the last usage on errors', async () => {
    app.ClaudeStatus.mockResolvedValueOnce({ usageError: 'offline' });
    app.OfficeTokens.mockResolvedValueOnce({ today: 1, week: 7 });
    let onTokens: (ev: unknown) => void = () => {};
    runtime.EventsOn.mockImplementationOnce((_name: string, cb: (ev: unknown) => void) => {
      onTokens = cb;
      return runtime.off;
    });
    const office = sink();
    const stop = connectOfficeFeeds(office);
    await Promise.resolve();
    await Promise.resolve();
    expect(office.setUsage).not.toHaveBeenCalled();
    expect(office.setWeekTokens).toHaveBeenCalledWith(7);

    onTokens({ termId: 't1', tokens: 42, today: 42, week: 49 });
    expect(office.setTokens).toHaveBeenCalledWith('t1', 42);
    expect(office.setWeekTokens).toHaveBeenLastCalledWith(49);

    stop();
    expect(runtime.off).toHaveBeenCalled();
  });

  it('drops replies that arrive after stop', async () => {
    let resolve: (v: unknown) => void = () => {};
    app.ClaudeStatus.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    app.OfficeTokens.mockResolvedValueOnce({ today: 0, week: 0 });
    runtime.EventsOn.mockReturnValueOnce(runtime.off);
    const office = sink();
    const stop = connectOfficeFeeds(office);
    stop();
    resolve({ usage: { windows: [{ key: 'five_hour', percent: 50 }] } });
    await Promise.resolve();
    await Promise.resolve();
    expect(office.setUsage).not.toHaveBeenCalled();
  });
});
