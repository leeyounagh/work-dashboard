/** Text over a character's head: the request's progress and the speech bubble. */
import { FONT } from './decor';

const BUBBLE = '#e3e5e8';
const BUBBLE_TEXT = '#1e1f22';
const BUBBLE_ALERT = '#e5c07b';

export const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A small bar (to-do fraction) and a label (2/5 step, or tools · time) above the name. */
export function drawProgress(ctx: CanvasRenderingContext2D, p: { fraction: number | null; text: string }, cx: number, bottom: number): void {
  const w = 64;
  const x = Math.round(cx - w / 2);
  if (p.fraction !== null) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, bottom - 6, w, 5);
    ctx.fillStyle = '#73c991';
    ctx.fillRect(x, bottom - 6, Math.round(w * Math.min(1, p.fraction)), 5);
  }
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = 'center';
  const label = short(p.text, 18);
  const tw = ctx.measureText(label).width + 8;
  ctx.fillStyle = 'rgba(20,21,24,0.75)';
  ctx.fillRect(Math.round(cx - tw / 2), bottom - 20, Math.round(tw), 13);
  ctx.fillStyle = '#e3e5e8';
  ctx.fillText(label, cx, bottom - 10);
}

export function drawBubble(ctx: CanvasRenderingContext2D, text: string, cx: number, bottom: number, alert: boolean): void {
  ctx.font = '10px "Cascadia Mono", Consolas, monospace';
  const label = short(text, 14);
  const w = Math.round(Math.min(ctx.measureText(label).width, 90) + 10);
  const x = Math.round(cx - w / 2);
  const y = bottom - 16;
  ctx.fillStyle = alert ? BUBBLE_ALERT : BUBBLE;
  ctx.fillRect(x, y, w, 14);
  ctx.fillRect(Math.round(cx) - 2, y + 14, 4, 3); // tail
  ctx.fillStyle = BUBBLE_TEXT;
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, y + 10);
}
