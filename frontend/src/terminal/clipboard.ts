/** Windows Terminal style copy/paste for xterm. */

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
export function clipboardAction(e: KeyLike, hasSelection: boolean): 'copy' | 'paste' | null {
  if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return null;
  // With a Korean IME active, e.key may not be the Latin letter; e.code is.
  const k = e.code === 'KeyV' ? 'v' : e.code === 'KeyC' ? 'c' : e.key.toLowerCase();
  if (k === 'v') return 'paste';
  if (k === 'c' && hasSelection) return 'copy';
  return null;
}
