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
export function clipboardAction(e: KeyLike, hasSelection: boolean, mac = false): 'copy' | 'paste' | null {
  // Cmd on macOS (where Ctrl+C must stay the terminal's interrupt), Ctrl elsewhere.
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (e.type !== 'keydown' || !mod || e.altKey) return null;
  // With a Korean IME active, e.key may not be the Latin letter; e.code is.
  const k = e.code === 'KeyV' ? 'v' : e.code === 'KeyC' ? 'c' : e.key.toLowerCase();
  if (k === 'v') return 'paste';
  if (k === 'c' && hasSelection) return 'copy';
  return null;
}
