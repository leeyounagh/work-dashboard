/** Gap kept between the bubble and the office's edges. */
const EDGE = 4;
/** How close to a corner the tail may go. */
const TAIL_ROOM = 14;

/**
 * The quiz offer: a speech bubble over a character, with yes and no buttons.
 * It lives over the canvas in the office panel, at canvas (CSS px) positions.
 */
export class QuizBubble {
  private readonly el: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private answer: ((yes: boolean) => void) | null = null;
  private x = NaN;
  private y = NaN;

  constructor(private readonly host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'quiz-bubble';
    this.el.setAttribute('role', 'dialog');
    this.el.hidden = true;
    this.text = document.createElement('span');
    const yes = this.button('예', true);
    const no = this.button('아니오', false);
    const buttons = document.createElement('div');
    buttons.className = 'quiz-buttons';
    buttons.append(yes, no);
    this.el.append(this.text, buttons);
    host.append(this.el);
  }

  private button(label: string, yes: boolean): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const answer = this.answer;
      this.hide();
      answer?.(yes);
    });
    return b;
  }

  show(question: string, x: number, y: number, answer: (yes: boolean) => void): void {
    this.text.textContent = question;
    this.answer = answer;
    this.el.hidden = false;
    this.move(x, y);
  }

  /**
   * Bottom centre of the bubble (just above the character's head), kept
   * inside the host: the office clips what sticks out.
   */
  move(x: number, y: number): void {
    const half = this.el.offsetWidth / 2 + EDGE;
    const room = this.host.clientWidth;
    const rx = Math.round(room > half * 2 ? Math.min(Math.max(x, half), room - half) : x);
    const ry = Math.round(Math.max(y, this.el.offsetHeight + EDGE));
    if (rx === this.x && ry === this.y) return;
    this.x = rx;
    this.y = ry;
    this.el.style.left = `${rx}px`;
    this.el.style.top = `${ry}px`;
    // Pushed in from an edge, the tail still points at the character.
    const tail = Math.max(-half + TAIL_ROOM, Math.min(half - TAIL_ROOM, x - rx));
    this.el.style.setProperty('--tail', `${Math.round(tail)}px`);
  }

  /** Closes without an answer (the offer expired or the session got busy). */
  hide(): void {
    this.el.hidden = true;
    this.answer = null;
  }

  destroy(): void {
    this.hide();
    this.el.remove();
  }
}
