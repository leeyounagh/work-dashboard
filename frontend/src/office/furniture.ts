/** Drawing the movable furniture laid out by furnitureLayout.ts. */
import { drawBookshelf, drawPlant, drawRug } from './background';
import { FONT, drawAquarium, drawSofa } from './decor';
import type { Box } from './furnitureLayout';
import { decorIndex, itemName, type ItemId } from './room';
import type { PlantHealth } from './vibe';

export function drawItems(ctx: CanvasRenderingContext2D, boxes: Box[], plants: PlantHealth, tick: number, decor: readonly HTMLImageElement[] = []): void {
  for (const b of boxes) {
    const k = decorIndex(b.id);
    if (k >= 0) {
      drawStandee(ctx, b, decor[k]);
      continue;
    }
    switch (b.id) {
      case 'plantLeft':
      case 'plantRight':
        drawPlant(ctx, b.x, b.y, plants);
        break;
      case 'rug':
        drawRug(ctx, b.x, b.y);
        break;
      case 'bookshelf':
        drawBookshelf(ctx, b.x, b.y);
        break;
      case 'sofa':
        drawSofa(ctx, b.x, b.y);
        break;
      case 'aquarium':
        drawAquarium(ctx, b.x, b.y, tick);
        break;
    }
  }
}

/** A standee: the user's picture on a small base, with a shadow on the floor. */
function drawStandee(ctx: CanvasRenderingContext2D, b: Box, img: HTMLImageElement | undefined): void {
  if (!img?.complete || !img.naturalWidth) return;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(b.x + 4, b.y + b.h - 3, b.w - 8, 4);
  // Pixel art stays crisp when enlarged; bigger pictures are smoothed when shrunk.
  ctx.imageSmoothingEnabled = img.naturalHeight > b.h;
  ctx.drawImage(img, b.x, b.y, b.w, b.h);
  ctx.imageSmoothingEnabled = false;
}

/** While decorating: a dashed outline round each piece, the active one highlighted and named. */
export function drawEditOverlay(ctx: CanvasRenderingContext2D, boxes: Box[], active: ItemId | null): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  for (const b of boxes) {
    const on = b.id === active;
    ctx.strokeStyle = on ? '#e5c07b' : 'rgba(227, 229, 232, 0.55)';
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    if (!on) continue;
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = 'center';
    const label = itemName(b.id);
    const tw = ctx.measureText(label).width + 8;
    const ty = Math.max(0, b.y - 16);
    ctx.fillStyle = 'rgba(20, 21, 24, 0.85)';
    ctx.fillRect(Math.round(b.x + b.w / 2 - tw / 2), ty, Math.round(tw), 14);
    ctx.fillStyle = '#e5c07b';
    ctx.fillText(label, b.x + b.w / 2, ty + 11);
  }
  ctx.restore();
}
