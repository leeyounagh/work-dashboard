/**
 * Works around xterm.js 5.5 sending the wrong text for IME input (Korean
 * syllables, digits typed in Korean mode, dead keys) when the page is busy.
 *
 * xterm works out what was typed in setTimeout(0) callbacks. When the next
 * keys are handled before they run (Claude printing, several terminals
 * drawing), they read stale offsets: a syllable comes out as the space typed
 * after it, the previous syllable is sent again (하나 → "하 하나"), a syllable
 * cut short by Enter is lost, and a key typed through the IME resends what
 * was typed after it (12 → "122") or turns into a DEL once Enter clears the
 * input.
 *
 * This patches the terminal's composition helper with the fix proposed
 * upstream (xtermjs/xterm.js#6250, PR #6275), and the same idea for keys:
 * - the composition's end offset is known at compositionupdate;
 * - every composition send starts at the earliest composition not yet sent,
 *   so whichever send runs first sends everything outstanding exactly once;
 * - a key's deferred diff stops where the next key or composition began, and
 *   is sent before any other key (Enter, Ctrl+C) or a blur clears the input.
 * Remove it once xterm ships a fix.
 */
import type { Terminal } from '@xterm/xterm';

const DEL = '\x7f';
const IME_KEY = 229;

/** A key typed through the IME whose textarea diff is still to be sent. */
interface PendingKey {
  cut?: number; // where the next key or composition began
  flush(): void;
}

/** The parts of xterm 5.5's (private) CompositionHelper this relies on. */
interface Helper {
  _textarea: HTMLTextAreaElement;
  _compositionView: HTMLElement;
  _coreService: { triggerDataEvent(data: string, wasUserInput?: boolean): void };
  _compositionPosition: { start: number; end: number };
  _isComposing: boolean;
  _isSendingComposition: boolean;
  keydown(ev: KeyboardEvent): boolean;
  compositionstart(): void;
  compositionupdate(ev: Pick<CompositionEvent, 'data'>): void;
  _finalizeComposition(waitForPropagation: boolean): void;
  _handleAnyTextareaChanges(): void;
}

const METHODS = ['keydown', 'compositionstart', 'compositionupdate', '_finalizeComposition', '_handleAnyTextareaChanges'];

function isHelper(h: unknown): h is Helper {
  if (typeof h !== 'object' || h === null) return false;
  const o = h as Record<string, unknown>;
  const pos = o._compositionPosition as Record<string, unknown> | null | undefined;
  return (
    o._textarea instanceof HTMLTextAreaElement &&
    o._compositionView instanceof HTMLElement &&
    typeof (o._coreService as Partial<Helper['_coreService']> | undefined)?.triggerDataEvent === 'function' &&
    typeof pos?.start === 'number' &&
    typeof pos?.end === 'number' &&
    typeof o._isComposing === 'boolean' &&
    typeof o._isSendingComposition === 'boolean' &&
    METHODS.every((m) => typeof o[m] === 'function')
  );
}

/** Patches one helper in place; false (and untouched) when it is not the shape this was written for. */
export function patchCompositionHelper(h: unknown): boolean {
  if (!isHelper(h)) return false;
  const send = (data: string) => h._coreService.triggerDataEvent(data, true);
  const keys = pendingKeys(h, send);

  const keydown = h.keydown.bind(h);
  h.keydown = (ev) => {
    // Any other key (Enter, Ctrl+C, arrows, …) may clear or act on the input: send what came before it first.
    if (ev.keyCode !== IME_KEY) keys.flushAll();
    return keydown(ev);
  };
  // Capture on the parent runs before xterm's own blur handler empties the textarea.
  h._textarea.parentElement?.addEventListener('blur', keys.flushAll, true);

  const start = h.compositionstart.bind(h);
  h.compositionstart = () => {
    start();
    keys.cutAt(h._compositionPosition.start);
  };

  const update = h.compositionupdate.bind(h);
  h.compositionupdate = (ev) => {
    update(ev);
    // The textarea only changes after this event; xterm reads the end from it
    // in a timer, too late if a key finalizes the composition first. (Its
    // timer still writes the same value later while the composition is open.)
    h._compositionPosition.end = h._compositionPosition.start + (ev.data ?? '').length;
  };

  h._finalizeComposition = finalizer(h, send);
  return true;
}

/** Replaces xterm's deferred textarea diff for keys typed through the IME outside a composition. */
function pendingKeys(h: Helper, send: (data: string) => void): { cutAt(pos: number): void; flushAll(): void } {
  const pending = new Set<PendingKey>();
  const cutAt = (pos: number) => {
    for (const k of pending) k.cut ??= pos;
  };
  h._handleAnyTextareaChanges = () => {
    const before = h._textarea.value;
    // Whatever came after an older key is this key's, not that one's.
    cutAt(before.length);
    const key: PendingKey = {
      flush: () => {
        if (!pending.delete(key)) return;
        const value = h._textarea.value;
        sendDiff(before, key.cut === undefined ? value : value.slice(0, key.cut), send);
      },
    };
    pending.add(key);
    setTimeout(key.flush, 0);
  };
  return {
    cutAt,
    // Oldest first (a Set iterates in insertion order).
    flushAll: () => {
      for (const k of pending) k.flush();
    },
  };
}

/** xterm's diff of the textarea around one key: a character typed, or a deletion. */
function sendDiff(before: string, after: string, send: (data: string) => void): void {
  if (after.length > before.length) send(after.replace(before, ''));
  else if (after.length < before.length) send(DEL);
  else if (after !== before) send(after);
}

/** Sends a finished composition: now when a key ends it, else once the textarea holds the committed text. */
function finalizer(h: Helper, send: (data: string) => void): (waitForPropagation: boolean) => void {
  // Start of the earliest composition whose text has not been sent yet.
  let unsentStart: number | undefined;
  return (waitForPropagation) => {
    h._compositionView.classList.remove('active');
    h._isComposing = false;
    if (!waitForPropagation) {
      // A key (Enter, space, …) ends the composition: send now, before the key.
      h._isSendingComposition = false;
      const from = unsentStart ?? h._compositionPosition.start;
      unsentStart = undefined;
      const input = h._textarea.value.substring(from, Math.max(from, h._compositionPosition.end));
      if (input.length > 0) send(input);
      return;
    }
    unsentStart ??= h._compositionPosition.start;
    h._isSendingComposition = true;
    setTimeout(() => {
      // Already sent, by a key or by an earlier timer.
      const from = unsentStart;
      if (from === undefined) return;
      h._isSendingComposition = false;
      unsentStart = undefined;
      // Up to the composition that has started since, or everything typed after.
      const input = h._isComposing
        ? h._textarea.value.substring(from, Math.max(from, h._compositionPosition.start))
        : h._textarea.value.substring(from);
      if (input.length > 0) send(input);
    }, 0);
  };
}

/** Applies the fix to an opened terminal; false when its internals have changed (an xterm upgrade). */
export function fixComposition(term: Terminal): boolean {
  const core = (term as unknown as { _core?: { _compositionHelper?: unknown } })._core;
  return patchCompositionHelper(core?._compositionHelper);
}
