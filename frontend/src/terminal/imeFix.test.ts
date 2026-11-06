// @vitest-environment happy-dom
import { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixComposition, patchCompositionHelper } from './imeFix';
import { openTerminal } from './openTerminal';

let term: Terminal;
let ta: HTMLTextAreaElement;
let sent: string[];
let compStart = 0;

const fire = (ev: Event) => ta.dispatchEvent(ev);
/** happy-dom drops `data` from the init dict. */
const comp = (type: string, data: string) => {
  const ev = new CompositionEvent(type, { data });
  Object.defineProperty(ev, 'data', { value: data });
  return ev;
};
// happy-dom ignores keyCode in the init dict.
const key = (type: string, k: string, keyCode: number) => {
  const ev = new KeyboardEvent(type, { key: k, bubbles: true });
  Object.defineProperty(ev, 'keyCode', { value: keyCode });
  fire(ev);
};
const keydown = (k: string, keyCode: number) => key('keydown', k, keyCode);
const keyup = (k: string, keyCode: number) => key('keyup', k, keyCode);

/** A Hangul syllable as the Windows IME types it, jamo by jamo: start, updates, then left open. */
const compose = (...steps: string[]) => {
  keydown('Process', 229);
  compStart = ta.value.length;
  fire(comp('compositionstart', ''));
  for (const s of steps) {
    fire(comp('compositionupdate', s));
    ta.value = ta.value.slice(0, compStart) + s;
    fire(new InputEvent('input', { data: s, inputType: 'insertCompositionText', bubbles: true, composed: true }));
  }
};
const commit = (s: string) => fire(comp('compositionend', s));
/**
 * Space while a syllable is open. The IME commits the syllable, and then either
 * inserts the space itself (keydown 229 first) or lets the space key through
 * as an ordinary key after the commit.
 */
let spaceAfterCommit = false;
const space = () => {
  if (spaceAfterCommit) {
    commit(ta.value.slice(compStart));
    keydown(' ', 32);
    const press = new KeyboardEvent('keypress', { key: ' ', bubbles: true });
    Object.defineProperty(press, 'charCode', { value: 32 });
    fire(press);
  } else {
    keydown('Process', 229);
    commit(ta.value.slice(compStart));
  }
  ta.value += ' ';
  fire(new InputEvent('input', { data: ' ', inputType: 'insertText', bubbles: true, composed: true }));
  keyup(' ', 32);
};
/** The next syllable starting commits the open one. */
const next = (...steps: string[]) => {
  commit(ta.value.slice(compStart));
  fire(comp('compositionstart', ''));
  compStart = ta.value.length;
  for (const s of steps) {
    fire(comp('compositionupdate', s));
    ta.value = ta.value.slice(0, compStart) + s;
    fire(new InputEvent('input', { data: s, inputType: 'insertCompositionText', bubbles: true, composed: true }));
  }
};
/** A digit typed in Korean mode: the IME inserts it, no composition. */
const imeDigit = (d: string) => {
  keydown('Process', 229);
  ta.value += d;
  fire(new InputEvent('input', { data: d, inputType: 'insertText', bubbles: true, composed: true }));
};
/** What stock xterm 5.5 sends for typeBusy() then 1, 2 typed in Korean mode, with the space after the commit. */
const STOCK_BUSY = '안 안녕  안녕 하 12하 12122';
const timers = () => new Promise((r) => setTimeout(r, 20));

/** 안녕 하 + Enter, all handled before xterm's 0 ms timers run (a busy page). */
const typeBusy = () => {
  compose('ㅇ', '아', '안');
  keydown('Process', 229);
  next('ㄴ', '녀', '녕');
  space();
  compose('ㅎ', '하');
  space();
};

beforeEach(() => {
  const el = document.createElement('div');
  document.body.append(el);
  term = new Terminal();
  term.open(el);
  ta = term.textarea!;
  ta.focus();
  sent = [];
  term.onData((d) => sent.push(d));
});

afterEach(() => term.dispose());

describe.each([
  ['the IME inserts the space', false],
  ['the space key comes after the commit', true],
])('composition fix: %s', (_name, after) => {
  beforeEach(() => {
    spaceAfterCommit = after;
  });

  it('sends each syllable once, with only the spaces typed, on a busy page', async () => {
    expect(fixComposition(term)).toBe(true);
    typeBusy();
    await timers();
    expect(sent.join('')).toBe('안녕 하 ');
  });

  it('still types correctly when the timers run between keys', async () => {
    fixComposition(term);
    compose('ㅇ', '아', '안');
    await timers();
    keydown('Process', 229);
    next('ㄴ', '녀', '녕');
    await timers();
    space();
    await timers();
    expect(sent.join('')).toBe('안녕 ');
  });

  it('sends the open syllable before Enter', async () => {
    fixComposition(term);
    compose('ㅎ', '하', '한');
    next('ㄱ', '그', '글');
    keydown('Enter', 13);
    await timers();
    expect(sent.join('')).toBe('한글\r');
  });

  it('sends a key typed through the IME right before a syllable once (1가)', async () => {
    fixComposition(term);
    keydown('Process', 229);
    ta.value += '1';
    fire(new InputEvent('input', { data: '1', inputType: 'insertText', bubbles: true, composed: true }));
    compose('ㄱ', '가');
    space();
    await timers();
    expect(sent.join('')).toBe('1가 ');
  });

  it('handles a final consonant moving to the next syllable (한 + ㅏ → 하나)', async () => {
    fixComposition(term);
    compose('ㅎ', '하', '한');
    // The vowel takes the ㄴ: the IME commits 하 and starts 나.
    ta.value = ta.value.slice(0, compStart) + '하';
    next('나');
    space();
    await timers();
    expect(sent.join('')).toBe('하나 ');
  });

});

describe('composition fix', () => {
  it('reproduces the stock xterm bugs on a busy page (guards that the tests still trigger them)', async () => {
    spaceAfterCommit = true;
    typeBusy();
    imeDigit('1');
    imeDigit('2');
    await timers();
    expect(sent.join('')).toBe(STOCK_BUSY);
  });

  it('sends digits typed in Korean mode once each, in order', async () => {
    fixComposition(term);
    imeDigit('1');
    imeDigit('2');
    imeDigit('3');
    await timers();
    expect(sent.join('')).toBe('123');
  });

  it('sends a digit typed in Korean mode before the Enter that clears the input', async () => {
    fixComposition(term);
    imeDigit('7');
    keydown('Enter', 13);
    await timers();
    expect(sent.join('')).toBe('7' + String.fromCharCode(13));
  });

  it('sends a digit typed in Korean mode before a blur clears the input', async () => {
    fixComposition(term);
    imeDigit('7');
    fire(new FocusEvent('blur'));
    await timers();
    expect(sent.join('')).toBe('7');
  });

  it('sends nothing for a syllable erased while composing', async () => {
    fixComposition(term);
    compose('ㄱ', '');
    commit('');
    await timers();
    imeDigit('1');
    await timers();
    expect(sent.join('')).toBe('1');
  });

  it('leaves plain typing alone', async () => {
    fixComposition(term);
    // xterm sends a lower-case letter on keydown (and cancels the keypress).
    keydown('a', 65);
    await timers();
    expect(sent.join('')).toBe('a');
  });

  it('is applied to every terminal the panel opens', async () => {
    term.dispose();
    const el = document.createElement('div');
    document.body.append(el);
    term = openTerminal(el, {}, false).term;
    ta = term.textarea!;
    sent = [];
    term.onData((d) => sent.push(d));
    spaceAfterCommit = true;
    typeBusy();
    await timers();
    expect(sent.join('')).toBe('안녕 하 ');
  });

  it('leaves anything that is not the xterm 5.5 helper alone', () => {
    expect(patchCompositionHelper(undefined)).toBe(false);
    expect(patchCompositionHelper({})).toBe(false);
    expect(patchCompositionHelper({ _finalizeComposition: () => undefined })).toBe(false);
  });
});
