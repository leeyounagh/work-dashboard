/**
 * Usage-driven decor drawn in plain pixels: the coffee counter, the MVP
 * frame, desk clutter, earned furniture, night, desk lamps and sunrise.
 */
import { confetti } from './vibe';

export const FONT = '"Segoe UI", "Malgun Gothic", sans-serif';

/** Width of the wall slots the room leaves for the coffee counter and the MVP frame. */
export const COUNTER_W = 60;
export const FRAME_W = 64;
const FRAME_H = 50;

/**
 * Wall slots for the MVP frame (left) and the coffee counter (right); null
 * when the office is too narrow for them (the frame goes first).
 */
export function wallSlots(w: number): { frameX: number | null; counterX: number | null } {
  return { frameX: w >= 320 ? 56 : null, counterX: w >= 240 ? w - 60 - COUNTER_W : null };
}

function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A counter against the wall (bottom at floorY) with a coffee pot showing what is left. */
export function drawCoffeeCounter(ctx: CanvasRenderingContext2D, x: number, floorY: number, level: number, tick: number): void {
  // Counter.
  rect(ctx, '#5b3a29', x, floorY - 26, COUNTER_W, 26);
  rect(ctx, '#7a4f37', x, floorY - 28, COUNTER_W, 4);
  rect(ctx, '#4a2f21', x + 4, floorY - 20, COUNTER_W - 8, 2);
  // Machine.
  const mx = x + 8;
  rect(ctx, '#5c5f68', mx, floorY - 56, 22, 28);
  rect(ctx, '#8a8e99', mx + 2, floorY - 54, 18, 6);
  rect(ctx, level > 0.02 ? '#73c991' : '#e06c75', mx + 16, floorY - 52, 2, 2); // power light
  // Glass pot under the machine: coffee rises from the bottom.
  const px = mx + 3;
  const py = floorY - 46;
  const ph = 16;
  rect(ctx, 'rgba(210,230,245,0.55)', px, py, 16, ph);
  const fill = Math.round(ph * level);
  if (fill > 0) rect(ctx, '#7a4a2a', px + 1, py + ph - fill, 14, fill);
  rect(ctx, '#1b1c1f', px + 16, py + 4, 3, 8); // handle
  // Steam while there is coffee.
  if (level > 0.02) {
    ctx.fillStyle = 'rgba(230,230,230,0.5)';
    const s = tick % 6;
    ctx.fillRect(px + 5, py - 6 - s, 2, 3);
    ctx.fillRect(px + 9, py - 9 - ((s + 3) % 6), 2, 3);
  }
  // Mugs.
  rect(ctx, '#e3e5e8', x + 38, floorY - 36, 7, 8);
  rect(ctx, '#d4a27f', x + 48, floorY - 36, 7, 8);
}

/**
 * Where idle characters queue when the pot is empty: standing in front of the
 * counter, above the first row of desks.
 */
export function coffeeSpot(w: number, wallH: number): { x: number; y: number } | null {
  const { counterX } = wallSlots(w);
  return counterX === null ? null : { x: counterX + COUNTER_W / 2, y: wallH + 10 };
}

/** A gold frame on the wall naming today's MVP (most tokens). */
export function drawMvpFrame(ctx: CanvasRenderingContext2D, x: number, top: number, name: string | null, tokens: string): void {
  rect(ctx, '#c9a227', x, top, FRAME_W, FRAME_H);
  rect(ctx, '#2b2d31', x + 4, top + 4, FRAME_W - 8, FRAME_H - 8);
  const inner = FRAME_W - 10;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e5c07b';
  ctx.font = `bold 9px ${FONT}`;
  ctx.fillText('오늘의 MVP', x + FRAME_W / 2, top + 16, inner);
  ctx.fillStyle = '#e3e5e8';
  ctx.font = `10px ${FONT}`;
  ctx.fillText(fit(ctx, name ?? '—', inner), x + FRAME_W / 2, top + 30);
  if (name) {
    ctx.fillStyle = '#9aa0a6';
    ctx.font = `9px ${FONT}`;
    ctx.fillText(tokens, x + FRAME_W / 2, top + 42, inner);
  }
}

/** Text shortened with … to fit width px in the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t}…`;
}

/** Paper stacked on the left of the desk and coffee cups on the right. */
export function drawDeskClutter(ctx: CanvasRenderingContext2D, cx: number, deskTop: number, papers: number, cups: number): void {
  const y = deskTop + 22;
  for (let i = 0; i < papers; i++) {
    rect(ctx, i % 2 ? '#d9dbe0' : '#f2f3f5', cx - 44 + (i % 2), y - i * 2, 14, 3);
  }
  for (let i = 0; i < cups; i++) {
    // Between the monitor and the desk lamp.
    const x = cx + 16 + i * 5;
    rect(ctx, '#e3e5e8', x, y - 4, 4, 6);
    rect(ctx, '#4b2c1c', x + 1, y - 3, 2, 1);
  }
}

/** A sweat drop next to a hard-working character's head. */
export function drawSweat(ctx: CanvasRenderingContext2D, x: number, y: number, tick: number): void {
  const dy = (tick % 8) * 2;
  rect(ctx, '#a9d4ff', x, y + dy, 5, 6);
  rect(ctx, '#a9d4ff', x + 1, y + dy - 3, 3, 3);
  rect(ctx, '#ffffff', x + 1, y + dy + 1, 1, 2);
}

/** Confetti bursting from (x, headY) and a trophy badge under the feet (x, feetY). */
export function drawCelebration(ctx: CanvasRenderingContext2D, x: number, headY: number, feetY: number, elapsed: number, label: string): void {
  for (const p of confetti(elapsed)) rect(ctx, p.color, x + p.x, headY + p.y, 3, 3);
  ctx.font = `bold 11px ${FONT}`;
  ctx.textAlign = 'center';
  const text = `🏆 ${label}`;
  const w = ctx.measureText(text).width + 12;
  const top = feetY + 17;
  rect(ctx, '#e5c07b', x - w / 2, top, w, 16);
  ctx.fillStyle = '#1e1f22';
  ctx.fillText(text, x, top + 12);
}

/**
 * Furniture earned over the week, along the bottom-left of the floor:
 * a bookshelf, then a sofa, then an aquarium.
 */
export function drawEarnedFurniture(
  ctx: CanvasRenderingContext2D,
  level: number,
  floorBottom: number,
  bookshelf: (x: number, bottom: number) => { w: number; h: number },
  tick: number,
): void {
  let x = 12;
  if (level >= 1) {
    const size = bookshelf(x, floorBottom);
    x += size.w + 8;
  }
  if (level >= 2) {
    const y = floorBottom - 30;
    rect(ctx, '#6b3f5e', x, y, 70, 22); // seat
    rect(ctx, '#7f4c70', x, y - 12, 70, 12); // back
    rect(ctx, '#58324d', x - 4, y - 8, 8, 30); // arms
    rect(ctx, '#58324d', x + 66, y - 8, 8, 30);
    rect(ctx, '#e5c07b', x + 12, y - 6, 12, 8); // cushion
    x += 84;
  }
  if (level >= 3) {
    const y = floorBottom - 46;
    rect(ctx, '#1b1c1f', x, y, 60, 40);
    rect(ctx, '#245a7a', x + 3, y + 3, 54, 34);
    rect(ctx, '#3a2a1a', x + 3, y + 31, 54, 6); // gravel
    rect(ctx, '#3f8f5a', x + 8, y + 18, 3, 13); // weed
    rect(ctx, '#3f8f5a', x + 46, y + 14, 3, 17);
    const fx = x + 10 + ((tick * 2) % 36);
    rect(ctx, '#e5884f', fx, y + 12, 7, 4); // fish
    rect(ctx, '#e5884f', fx - 3, y + 11, 3, 6);
    rect(ctx, 'rgba(255,255,255,0.6)', x + 30, y + 6 + (tick % 20), 2, 2); // bubble
  }
}

/** The night overlay (the room and desks; characters stay bright on top). */
export function drawNight(ctx: CanvasRenderingContext2D, w: number, h: number, dark: number): void {
  if (dark <= 0) return;
  ctx.fillStyle = `rgba(8, 12, 32, ${dark})`;
  ctx.fillRect(0, 0, w, h);
}

/** A warm pool of light around each desk lamp. */
const GLOW_R = 64;
let glow: HTMLCanvasElement | null = null;

/** The lamp light, drawn once and reused every frame. */
function lampGlow(): HTMLCanvasElement {
  if (glow) return glow;
  glow = document.createElement('canvas');
  glow.width = glow.height = GLOW_R * 2;
  const g = glow.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(GLOW_R, GLOW_R, 2, GLOW_R, GLOW_R, GLOW_R);
    grad.addColorStop(0, 'rgba(255, 210, 140, 0.45)');
    grad.addColorStop(1, 'rgba(255, 210, 140, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, GLOW_R * 2, GLOW_R * 2);
  }
  return glow;
}

export function drawLamp(ctx: CanvasRenderingContext2D, cx: number, deskTop: number): void {
  const lx = cx + 34;
  const ly = deskTop + 8;
  ctx.drawImage(lampGlow(), lx - GLOW_R, ly + 16 - GLOW_R);
  rect(ctx, '#3c3e45', lx, ly + 2, 2, 14); // stand
  rect(ctx, '#e5c07b', lx - 4, ly - 2, 10, 5); // shade
}

/** Morning light washing in from the top after the 5-hour window resets. */
export function drawSunrise(ctx: CanvasRenderingContext2D, w: number, h: number, progress: number): void {
  if (progress <= 0 || progress >= 1) return;
  const alpha = Math.sin(progress * Math.PI) * 0.35;
  const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
  g.addColorStop(0, `rgba(255, 214, 120, ${alpha})`);
  g.addColorStop(1, 'rgba(255, 214, 120, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.font = `bold 12px ${FONT}`;
  ctx.fillStyle = `rgba(255, 230, 170, ${alpha * 2.5})`;
  ctx.fillText('☀ 한도 초기화 — 좋은 아침!', w / 2, h - 10);
}
