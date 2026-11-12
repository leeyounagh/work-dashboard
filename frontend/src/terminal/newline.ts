import type { KeyLike } from './clipboard';

/**
 * What Shift+Enter sends to Claude Code: ESC + CR (Meta+Enter), the same
 * sequence Claude's /terminal-setup binds in VS Code and Cursor. Claude reads
 * it as "new line" instead of "submit"; xterm alone sends a plain CR.
 */
export const NEWLINE_SEQUENCE = '\x1b\r';

/** Shift+Enter with no other modifier, on any event type xterm looks at. */
export function isShiftEnter(e: KeyLike): boolean {
  return e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
}
