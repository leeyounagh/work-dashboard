import { describe, expect, it } from 'vitest';
import { isShiftEnter, NEWLINE_SEQUENCE } from './newline';

const key = (k: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean } = {}) => ({
  type: 'keydown',
  key: k,
  shiftKey: mods.shift ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
});

describe('isShiftEnter', () => {
  it('is Shift+Enter only', () => {
    expect(isShiftEnter(key('Enter', { shift: true }))).toBe(true);
    expect(isShiftEnter(key('Enter'))).toBe(false);
    expect(isShiftEnter(key('Enter', { shift: true, ctrl: true }))).toBe(false);
    expect(isShiftEnter(key('Enter', { shift: true, alt: true }))).toBe(false);
    expect(isShiftEnter(key('Enter', { shift: true, meta: true }))).toBe(false);
    expect(isShiftEnter(key('a', { shift: true }))).toBe(false);
  });

  it('sends ESC + CR, which Claude Code reads as a new line', () => {
    expect(NEWLINE_SEQUENCE).toBe('\x1b\r');
  });
});
