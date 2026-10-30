/** Drawing for the office events in fun.ts, in plain pixels like decor.ts. */
import { FONT } from './decor';
import { confetti } from './vibe';
import { ACHIEVEMENTS } from './fun';

function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

/** A gold banner across the top of the room that drops in, with confetti from its ends. */
export function drawBanner(ctx: CanvasRenderingContext2D, roomW: number, text: string, elapsed: number): void {
  ctx.font = `bold 12px ${FONT}`;
  const w = Math.min(roomW - 16, Math.round(ctx.measureText(text).width + 28));
  const x = Math.round((roomW - w) / 2);
  const y = Math.round(Math.min(1, elapsed / 300) * 30) - 22;
  for (const p of confetti(elapsed)) {
    rect(ctx, p.color, x + p.x * 0.6, y + 10 + p.y * 0.5, 3, 3);
    rect(ctx, p.color, x + w - p.x * 0.6, y + 10 + p.y * 0.5, 3, 3);
  }
  rect(ctx, '#1e1f22', x - 1, y - 1, w + 2, 22);
  rect(ctx, '#e5c07b', x, y, w, 20);
  rect(ctx, '#c9a227', x, y + 17, w, 3);
  // Ribbon tails.
  rect(ctx, '#c9a227', x - 8, y + 4, 8, 14);
  rect(ctx, '#c9a227', x + w, y + 4, 8, 14);
  ctx.fillStyle = '#1e1f22';
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + 14, w - 12);
}

/** A red "!" by a character that has waited on you too long. */
export function drawExclaim(ctx: CanvasRenderingContext2D, x: number, y: number, tick: number): void {
  if (tick % 10 >= 8) return; // blinks
  rect(ctx, '#1e1f22', x - 1, y - 1, 10, 18);
  rect(ctx, '#e06c75', x, y, 8, 16);
  rect(ctx, '#ffffff', x + 3, y + 2, 2, 8);
  rect(ctx, '#ffffff', x + 3, y + 12, 2, 2);
}

/** A flame by the name of a character on a work streak; bigger with the level (1–3). */
export function drawFlame(ctx: CanvasRenderingContext2D, x: number, bottom: number, level: number, tick: number): void {
  if (level < 1) return;
  const s = level + 1; // px per flame pixel
  const flick = tick % 4 < 2 ? 0 : 1;
  const px = (color: string, cx: number, cy: number, w: number, h: number) => rect(ctx, color, x + cx * s, bottom - (cy + h) * s, w * s, h * s);
  px('#e06c75', 0, 0, 5, 3);
  px('#e06c75', 1, 3, 3, 2);
  px('#e06c75', 2 - flick, 5, 1, 1);
  px('#e5c07b', 1, 0, 3, 2);
  px('#e5c07b', 2, 2, 1, 1 + flick);
  px('#ffffff', 2, 0, 1, 1);
}

/** Two hands clapping over a high five. */
export function drawClap(ctx: CanvasRenderingContext2D, x: number, y: number, elapsed: number): void {
  const rise = Math.round(Math.min(1, elapsed / 400) * 8);
  rect(ctx, '#e3e5e8', x - 14, y - 18 - rise, 28, 18);
  rect(ctx, '#e3e5e8', x - 2, y - rise, 4, 3);
  ctx.font = `12px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1e1f22';
  ctx.fillText('👏', x, y - 5 - rise);
}

/** The day's achievement badges in a row starting at (x, y); hover text is left to the canvas title. */
export function drawBadges(ctx: CanvasRenderingContext2D, x: number, y: number, earned: readonly string[]): number {
  const shown = ACHIEVEMENTS.filter((a) => earned.includes(a.id));
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = 'center';
  shown.forEach((a, i) => {
    const bx = x + i * 14;
    rect(ctx, '#c9a227', bx, y, 13, 13);
    rect(ctx, '#2b2d31', bx + 1, y + 1, 11, 11);
    ctx.fillStyle = '#e3e5e8';
    ctx.fillText(a.icon, bx + 6.5, y + 10.5);
  });
  return shown.length * 14;
}
