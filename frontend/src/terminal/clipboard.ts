/** Windows Terminal style copy/paste for xterm (Cmd on macOS). */

export interface KeyLike {
  type: string;
  key: string;
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * What a key press should do with the clipboard. Ctrl+C copies only when text
 * is selected; with no selection it stays ^C (interrupt) for the shell.
 */
export function clipboardAction(e: KeyLike, hasSelection: boolean, mac = false): 'copy' | 'paste' | 'block' | null {
  // Cmd on macOS (where Ctrl+C must stay the terminal's interrupt), Ctrl elsewhere.
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (e.type !== 'keydown' || !mod || e.altKey) return null;
  // With a Korean IME active, e.key may not be the Latin letter; e.code is.
  const k = e.code === 'KeyV' ? 'v' : e.code === 'KeyC' ? 'c' : e.key.toLowerCase();
  if (k === 'v') return 'paste';
  if (k === 'c') {
    if (hasSelection) return 'copy';
    // macOS: the Edit menu's Copy would copy the hidden input's empty
    // selection and wipe the clipboard (Cmd+C means nothing to a terminal).
    if (mac) return 'block';
  }
  return null;
}

/**
 * The text of an OSC 52 "set clipboard" sequence (ESC ] 52 ; c ; base64 BEL),
 * which is how Claude Code copies its own mouse selection. null for a
 * clipboard query ("?") or anything malformed.
 */
export function osc52Text(data: string): string | null {
  const sep = data.indexOf(';');
  if (sep < 0) return null;
  const payload = data.slice(sep + 1);
  if (payload === '?') return null;
  try {
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
