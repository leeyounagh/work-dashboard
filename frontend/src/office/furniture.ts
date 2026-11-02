/** Drawing the movable furniture laid out by furnitureLayout.ts. */
import { drawBookshelf, drawPlant, drawRug } from './background';
import { FONT, drawAquarium, drawSofa } from './decor';
import type { Box } from './furnitureLayout';
import { ITEMS, type ItemId } from './room';
import type { PlantHealth } from './vibe';

export function drawItems(ctx: CanvasRenderingContext2D, boxes: Box[], plants: PlantHealth, tick: number): void {
  for (const b of boxes) {
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
    const label = ITEMS[b.id].name;
    const tw = ctx.measureText(label).width + 8;
    const ty = Math.max(0, b.y - 16);
    ctx.fillStyle = 'rgba(20, 21, 24, 0.85)';
    ctx.fillRect(Math.round(b.x + b.w / 2 - tw / 2), ty, Math.round(tw), 14);
    ctx.fillStyle = '#e5c07b';
    ctx.fillText(label, b.x + b.w / 2, ty + 11);
  }
  ctx.restore();
}
