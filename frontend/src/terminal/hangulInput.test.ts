// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bridgeHangulInput } from './hangulInput';

const DEL = '\x7f';

let root: HTMLDivElement;
let textarea: HTMLTextAreaElement;
let sent: string[];
let xtermSaw: string[];
let stop: () => void;

const input = (inputType: string, data: string | null) =>
  textarea.dispatchEvent(new InputEvent('input', { inputType, data, bubbles: true }));

const keydown = (key: string, keyCode: number) => {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true });
  Object.defineProperty(ev, 'keyCode', { value: keyCode });
  textarea.dispatchEvent(ev);
};

/** One jamo typed under the macOS Korean IME, in the order WebKit reports it (input before keydown). */
const jamo = (inputType: 'insertText' | 'insertReplacementText', data: string, key: string) => {
  input(inputType, data);
  keydown(key, 229);
};

beforeEach(() => {
  root = document.createElement('div');
  textarea = document.createElement('textarea');
  root.append(textarea);
  document.body.append(root);
  sent = [];
  xtermSaw = [];
  // Stands in for xterm's own listeners on its helper textarea.
  textarea.addEventListener('input', (e) => xtermSaw.push(`input:${(e as InputEvent).data}`));
  textarea.addEventListener('keydown', (e) => xtermSaw.push(`keydown:${e.key}`));
  stop = bridgeHangulInput(root, (d) => sent.push(d));
});

afterEach(() => {
  stop();
  root.remove();
});

/** What the terminal line shows after the sent data, applying DEL. */
const line = () =>
  sent.join('').split('').reduce((acc, ch) => (ch === DEL ? Array.from(acc).slice(0, -1).join('') : acc + ch), '');

describe('bridgeHangulInput', () => {
  it('sends 한글 as whole syllables, rewriting the composing one in place', () => {
    jamo('insertText', 'ㅎ', 'ㅎ');
    jamo('insertReplacementText', '하', 'ㅏ');
    jamo('insertReplacementText', '한', 'ㄴ');
    jamo('insertText', 'ㄱ', 'ㄱ');
    jamo('insertReplacementText', '그', 'ㅡ');
    jamo('insertReplacementText', '글', 'ㄹ');

    expect(line()).toBe('한글');
    expect(sent).toEqual(['ㅎ', `${DEL}하`, `${DEL}한`, 'ㄱ', `${DEL}그`, `${DEL}글`]);
  });

  it('moves a final consonant to the next syllable (텟 + ㅡ → 테스), as recorded in WebKit', () => {
    jamo('insertText', 'ㅌ', 'ㅌ');
    jamo('insertReplacementText', '테', 'ㅔ');
    jamo('insertReplacementText', '텟', 'ㅅ');
    // ㅡ: the IME gives the ㅅ back to 테 and starts 스 with it.
    input('insertReplacementText', '테');
    input('insertText', '스');
    keydown('ㅡ', 229);

    expect(line()).toBe('테스');
  });

  it('keeps the Hangul input events and the IME keydowns away from xterm', () => {
    jamo('insertText', 'ㅎ', 'ㅎ');
    jamo('insertReplacementText', '하', 'ㅏ');

    expect(xtermSaw).toEqual([]);
  });

  it('does not resend when the IME commits the same syllable (before Enter)', () => {
    jamo('insertText', 'ㅌ', 'ㅌ');
    jamo('insertReplacementText', '트', 'ㅡ');
    input('insertReplacementText', '트');

    expect(sent).toEqual(['ㅌ', `${DEL}트`]);
  });

  it('a real key ends the syllable, so the next jamo starts a new character', () => {
    jamo('insertText', 'ㅎ', 'ㅎ');
    keydown('Enter', 13);
    // xterm handles Enter itself.
    expect(xtermSaw).toEqual(['keydown:Enter']);

    jamo('insertReplacementText', '하', 'ㅏ');
    expect(sent).toEqual(['ㅎ', '하']);
  });

  it('sends DEL when the IME deletes the composing jamo after taking the Backspace keydown', () => {
    jamo('insertText', 'ㅎ', 'ㅎ');
    input('deleteContentBackward', null);

    expect(line()).toBe('');
  });

  it('leaves non-Hangul input and other deletions to xterm', () => {
    input('insertText', 'a');
    input('deleteContentBackward', null);
    keydown('a', 65);

    expect(sent).toEqual([]);
    expect(xtermSaw).toEqual(['input:a', 'input:', 'keydown:a']); // happy-dom reports a null data as ''
  });

  it('does not block an IME keydown when nothing Hangul is being composed', () => {
    keydown('1', 229);

    expect(xtermSaw).toEqual(['keydown:1']);
  });

  it('stops listening when disposed', () => {
    stop();
    input('insertText', 'ㅎ');

    expect(sent).toEqual([]);
    expect(xtermSaw).toEqual(['input:ㅎ']);
  });
});
