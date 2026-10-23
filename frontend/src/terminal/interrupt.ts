/**
 * Claude Code sends no hook when the user stops a request with Esc; it only
 * prints "Interrupted". This spots that notice in a terminal's output so the
 * office can stop showing the character at work.
 */

// Claude Code's own notice ("⎿  Interrupted · What should Claude do instead?",
// "Interrupted by user"), not any output that merely contains the word.
// Cursor moves may stand in for the spaces, and they are stripped below.
const NOTICE = /Interrupted\s*(?:·|by\s*user)/;
// CSI / OSC escape sequences and other control characters.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|[\x00-\x08\x0b-\x1f\x7f]/g;
const TAIL = 64; // enough to join a word or escape sequence split across chunks

export class InterruptWatch {
  private readonly decoders = new Map<string, TextDecoder>();
  private readonly tails = new Map<string, string>();

  /** Feeds a chunk of a terminal's output; true when it completes an interrupt notice. */
  feed(id: string, bytes: Uint8Array): boolean {
    let decoder = this.decoders.get(id);
    if (!decoder) {
      decoder = new TextDecoder();
      this.decoders.set(id, decoder);
    }
    const text = (this.tails.get(id) ?? '') + decoder.decode(bytes, { stream: true });
    const plain = text.replace(ANSI, '');
    const hit = NOTICE.test(plain);
    // After a hit nothing is kept, so the same notice is not reported twice.
    this.tails.set(id, hit ? '' : text.slice(-TAIL));
    return hit;
  }

  forget(id: string): void {
    this.decoders.delete(id);
    this.tails.delete(id);
  }
}
