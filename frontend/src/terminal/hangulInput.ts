/**
 * Korean input for xterm.js under macOS WebKit (WKWebView, Safari).
 *
 * There the macOS Korean IME fires no composition events. It inserts each new
 * jamo with an `insertText` input event and then rewrites the last character
 * in place with `insertReplacementText` (ㅅ → 텟 → 테 + 스); the keydown
 * (keyCode 229) only arrives after that input event. xterm.js forwards just
 * the first `insertText` of each syllable, so 한글 reaches the terminal as ㅎㄱ
 * (also with xterm 6.0, and in Safari without this app).
 *
 * This takes those Hangul input events before xterm sees them and sends them
 * itself: a new character as is, a rewritten last character as DEL plus the
 * new one, so the line shows the syllable while it is being composed.
 */

const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힣ힰ-퟿]/;
const DEL = '\x7f';
const IME_KEY = 229;

const lastChar = (s: string) => Array.from(s).pop() ?? '';

/** Listens on `root` (an ancestor of xterm's textarea) in the capture phase; returns a function that stops it. */
export function bridgeHangulInput(root: HTMLElement, send: (data: string) => void): () => void {
  // The character we last sent that the IME may still rewrite.
  let composing: string | null = null;

  const onInput = (e: Event) => {
    const ev = e as InputEvent;
    const data = ev.data ?? '';
    if (ev.inputType === 'insertText' && HANGUL.test(data)) {
      send(data);
      composing = lastChar(data);
    } else if (ev.inputType === 'insertReplacementText' && HANGUL.test(data)) {
      if (composing === null) send(data);
      else if (data !== composing) send(DEL + data);
      composing = lastChar(data);
    } else if (ev.inputType === 'deleteContentBackward' && composing !== null) {
      // The IME took the Backspace keydown and deleted the jamo being composed itself.
      send(DEL);
      composing = null;
    } else {
      composing = null;
      return;
    }
    e.stopPropagation();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.keyCode === IME_KEY) {
      // The IME's late keydown for an input already sent above; xterm would
      // diff the textarea on it and send the text again.
      if (composing !== null) e.stopPropagation();
      return;
    }
    // Any real key (Enter, space, arrows, Ctrl+…) ends the syllable.
    composing = null;
  };

  const onBlur = () => {
    composing = null;
  };

  root.addEventListener('input', onInput, true);
  root.addEventListener('keydown', onKeyDown, true);
  root.addEventListener('focusout', onBlur, true);
  return () => {
    root.removeEventListener('input', onInput, true);
    root.removeEventListener('keydown', onKeyDown, true);
    root.removeEventListener('focusout', onBlur, true);
  };
}
