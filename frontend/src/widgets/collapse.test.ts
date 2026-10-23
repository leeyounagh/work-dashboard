import { describe, expect, it } from 'vitest';
import { collapseKey, parseCollapsed, toggleCollapsed } from './collapse';

describe('collapsed widgets', () => {
  it('is keyed per workspace and widget type', () => {
    expect(collapseKey('groupware', 'linear-issues')).toBe('groupware/linear-issues');
  });

  it('toggles without mutating', () => {
    const a = {};
    const b = toggleCollapsed(a, 'w/x');
    expect(b).toEqual({ 'w/x': true });
    expect(a).toEqual({});
    expect(toggleCollapsed(b, 'w/x')).toEqual({});
  });

  it('parses stored state and ignores junk', () => {
    expect(parseCollapsed('{"w/x":true,"w/y":false,"w/z":"yes"}')).toEqual({ 'w/x': true });
    expect(parseCollapsed('[1]')).toEqual({});
    expect(parseCollapsed('nope')).toEqual({});
    expect(parseCollapsed(null)).toEqual({});
  });
});
