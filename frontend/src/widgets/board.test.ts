import { describe, expect, it } from 'vitest';
import { alertKey, upsertWidget } from './board';
import type { Instance } from '../lib/widgets';

describe('upsertWidget', () => {
  const prev: Instance[] = [{ type: 'a', enabled: true, settings: { x: 1 } }];

  it('updates the existing instance of a type without mutating', () => {
    const next = upsertWidget(prev, 'a', (w) => ({ ...w, enabled: false }));
    expect(next).toEqual([{ type: 'a', enabled: false, settings: { x: 1 } }]);
    expect(prev[0].enabled).toBe(true);
  });

  it('adds a missing type once, even when toggled twice', () => {
    const on = upsertWidget(prev, 'b', (w) => ({ ...w, enabled: true }));
    const off = upsertWidget(on, 'b', (w) => ({ ...w, enabled: false }));
    expect(off.filter((w) => w.type === 'b')).toEqual([{ type: 'b', enabled: false, settings: {} }]);
  });
});

describe('alertKey', () => {
  const now = Date.parse('2026-10-23T10:30:00Z');
  it('is one key per reset window', () => {
    expect(alertKey('five_hour', '2026-10-23T14:00:00Z', now)).toBe('five_hour@2026-10-23T14:00:00Z');
  });
  it('falls back to an hourly key when the reset time is unknown', () => {
    const k = alertKey('five_hour', '0001-01-01T00:00:00Z', now);
    expect(k).toMatch(/^five_hour@hour-/);
    expect(alertKey('five_hour', '', now)).toBe(k);
    expect(alertKey('five_hour', '', now + 3_600_000)).not.toBe(k);
  });
});
