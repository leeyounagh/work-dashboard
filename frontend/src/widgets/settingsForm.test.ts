import { describe, expect, it } from 'vitest';
import type { SettingSpec } from '../lib/widgets';
import { formatSetting, parseSetting } from './settingsForm';

const spec = (kind: SettingSpec['kind'], extra: Partial<SettingSpec> = {}): SettingSpec => ({
  key: 'k',
  label: 'K',
  kind,
  default: null,
  min: 0,
  max: 0,
  ...extra,
});

describe('formatSetting', () => {
  it('formats lists as comma-separated text', () => {
    expect(formatSetting(spec('stringList'), ['a', 'b'])).toBe('a, b');
    expect(formatSetting(spec('stringList'), null)).toBe('');
  });
  it('formats scalars as text', () => {
    expect(formatSetting(spec('int'), 3)).toBe('3');
    expect(formatSetting(spec('string'), undefined)).toBe('');
  });
});

describe('parseSetting', () => {
  it('parses lists, trimming and dropping empties', () => {
    expect(parseSetting(spec('stringList'), ' a, ,b ,')).toEqual({ ok: true, value: ['a', 'b'] });
  });

  it('parses integers within range', () => {
    const s = spec('int', { min: 1, max: 10 });
    expect(parseSetting(s, '5')).toEqual({ ok: true, value: 5 });
    expect(parseSetting(s, '11').ok).toBe(false);
    expect(parseSetting(s, '2.5').ok).toBe(false);
    expect(parseSetting(s, 'abc').ok).toBe(false);
  });

  it('parses booleans and enums', () => {
    expect(parseSetting(spec('bool'), true)).toEqual({ ok: true, value: true });
    const e = spec('enum', { options: ['mine', 'both'] });
    expect(parseSetting(e, 'both')).toEqual({ ok: true, value: 'both' });
    expect(parseSetting(e, 'nope').ok).toBe(false);
  });

  it('keeps strings as typed', () => {
    expect(parseSetting(spec('string'), ' origin/test ')).toEqual({ ok: true, value: 'origin/test' });
  });
});
