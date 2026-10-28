import { describe, expect, it } from 'vitest';
import { clipboardAction, osc52Text } from './clipboard';

const key = (k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}) => ({
  type: 'keydown',
  key: k,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
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

  it('uses the physical key when an IME changes e.key', () => {
    expect(clipboardAction({ ...key('ㅍ', { ctrl: true }), code: 'KeyV' }, false)).toBe('paste');
    expect(clipboardAction({ ...key('ㅊ', { ctrl: true }), code: 'KeyC' }, true)).toBe('copy');
  });

  it('on macOS Cmd copies and pastes, and Ctrl stays with the terminal', () => {
    expect(clipboardAction(key('c', { meta: true }), true, true)).toBe('copy');
    expect(clipboardAction(key('v', { meta: true }), false, true)).toBe('paste');
    expect(clipboardAction(key('c', { ctrl: true }), true, true)).toBeNull(); // ^C interrupts
    expect(clipboardAction(key('v', { ctrl: true }), false, true)).toBeNull();
    // Without a selection Cmd+C is swallowed, so the Edit menu cannot wipe the clipboard.
    expect(clipboardAction(key('c', { meta: true }), false, true)).toBe('block');
  });

  it('ignores other keys and key-ups', () => {
    expect(clipboardAction(key('v'), false)).toBeNull();
    expect(clipboardAction(key('v', { ctrl: true, alt: true }), false)).toBeNull();
    expect(clipboardAction({ ...key('v', { ctrl: true }), type: 'keyup' }, false)).toBeNull();
    expect(clipboardAction(key('x', { ctrl: true }), true)).toBeNull();
  });
});

describe('osc52Text', () => {
  const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

  it('decodes the copied text, Korean included', () => {
    expect(osc52Text(`c;${b64('hello')}`)).toBe('hello');
    expect(osc52Text(`c;${b64('한글 복사')}`)).toBe('한글 복사');
    expect(osc52Text(`;${b64('no target')}`)).toBe('no target');
  });

  it('ignores clipboard queries and malformed sequences', () => {
    expect(osc52Text('c;?')).toBeNull();
    expect(osc52Text('nosemicolon')).toBeNull();
    expect(osc52Text('c;%%%')).toBeNull();
  });
});
