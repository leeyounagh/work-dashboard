import { describe, expect, it } from 'vitest';
import { clipboardAction } from './clipboard';

const key = (k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  type: 'keydown',
  key: k,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: false,
});

describe('clipboardAction', () => {
  it('Ctrl+C copies only when text is selected, otherwise it interrupts', () => {
    expect(clipboardAction(key('c', { ctrl: true }), true)).toBe('copy');
    expect(clipboardAction(key('c', { ctrl: true }), false)).toBeNull(); // sent to the shell as ^C
  });

  it('Ctrl+V and Ctrl+Shift+V paste; Ctrl+Shift+C copies', () => {
    expect(clipboardAction(key('v', { ctrl: true }), false)).toBe('paste');
    expect(clipboardAction(key('V', { ctrl: true, shift: true }), false)).toBe('paste');
    expect(clipboardAction(key('C', { ctrl: true, shift: true }), true)).toBe('copy');
  });

  it('ignores other keys and key-ups', () => {
    expect(clipboardAction(key('v'), false)).toBeNull();
    expect(clipboardAction(key('v', { ctrl: true, alt: true }), false)).toBeNull();
    expect(clipboardAction({ ...key('v', { ctrl: true }), type: 'keyup' }, false)).toBeNull();
    expect(clipboardAction(key('x', { ctrl: true }), true)).toBeNull();
  });
});
