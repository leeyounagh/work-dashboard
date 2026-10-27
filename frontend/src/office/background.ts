/**
 * The office room drawn from the CC0 Ninja Adventure tileset: a dark wooden
 * floor, a bookshelf wall, plants, a rug, and one desk per terminal.
 */
import tilesetUrl from '../assets/tileset.png';
import { FRAME_W, wallSlots } from './decor';
import type { PlantHealth } from './vibe';

const T = 16; // tileset tile size
const S = 2; // decor scale (32px per tile)

/** Tileset regions: column, row, width, height in tiles. */
const TILES = {
  floor: [25, 8, 1, 1],
  bookshelf: [10, 37, 2, 2],
  bookshelfSmall: [12, 37, 1, 2],
  drawers: [5, 37, 2, 2],
  plant: [0, 37, 1, 2],
  rug: [7, 37, 3, 3],
  desk: [18, 38, 3, 1],
  stool: [16, 38, 1, 1],
} as const;

type Tile = keyof typeof TILES;

const img = new Image();
img.src = tilesetUrl;

const ready = () => img.complete && img.naturalWidth > 0;

function tile(ctx: CanvasRenderingContext2D, name: Tile, x: number, y: number, scale = S) {
  const [c, r, w, h] = TILES[name];
  ctx.drawImage(img, c * T, r * T, w * T, h * T, Math.round(x), Math.round(y), w * T * scale, h * T * scale);
}

/** Size in CSS px of a tile region at the decor scale. */
export function tileSize(name: Tile): { w: number; h: number } {
  const [, , w, h] = TILES[name];
  return { w: w * T * S, h: h * T * S };
}

/** Plant tinted brown as it wilts, cached per health. */
const plantCache = new Map<PlantHealth, HTMLCanvasElement>();

function plantFor(health: PlantHealth): CanvasImageSource {
  if (health === 'fresh') return img;
  const hit = plantCache.get(health);
  if (hit) return hit;
  const [c, r, w, h] = TILES.plant;
  const off = document.createElement('canvas');
  off.width = w * T;
  off.height = h * T;
  const o = off.getContext('2d');
  if (!o) return img;
  o.drawImage(img, c * T, r * T, w * T, h * T, 0, 0, w * T, h * T);
  // Brown only the plant's own pixels.
  o.globalCompositeOperation = 'source-atop';
  o.fillStyle = health === 'droopy' ? 'rgba(150, 120, 50, 0.4)' : 'rgba(110, 70, 30, 0.75)';
  o.fillRect(0, 0, off.width, off.height);
  plantCache.set(health, off);
  return off;
}

function drawPlant(ctx: CanvasRenderingContext2D, x: number, y: number, health: PlantHealth) {
  const size = tileSize('plant');
  const src = plantFor(health);
  if (src === img) tile(ctx, 'plant', x, y);
  else ctx.drawImage(src, Math.round(x), Math.round(y), size.w, size.h);
  if (health === 'wilted') {
    // Fallen leaves at the pot.
    ctx.fillStyle = '#8a6a32';
    ctx.fillRect(Math.round(x) - 4, Math.round(y + size.h - 4), 4, 2);
    ctx.fillRect(Math.round(x + size.w) + 1, Math.round(y + size.h - 2), 4, 2);
  }
}

/** A floor-standing bookshelf (earned furniture) standing on bottom. */
export function drawBookshelf(ctx: CanvasRenderingContext2D, x: number, bottom: number): { w: number; h: number } {
  const size = tileSize('bookshelf');
  if (ready()) tile(ctx, 'bookshelf', x, bottom - size.h);
  return size;
}

/**
 * Floor, wall and decor. Falls back to a plain dark floor until the tileset
 * has loaded.
 */
export function drawRoom(ctx: CanvasRenderingContext2D, w: number, h: number, wallH: number, plants: PlantHealth = 'fresh'): void {
  if (!ready()) {
    ctx.fillStyle = '#25262a';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const step = T * S;
  for (let y = wallH; y < h; y += step) for (let x = 0; x < w; x += step) tile(ctx, 'floor', x, y);
  // Darken the warm wood to sit with the dark-gray UI.
  ctx.fillStyle = 'rgba(16, 17, 20, 0.58)';
  ctx.fillRect(0, wallH, w, h - wallH);

  // Wall with a row of bookshelves and drawers.
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, w, wallH);
  ctx.fillStyle = '#3a3c42';
  ctx.fillRect(0, wallH - 4, w, 4);
  const shelf = tileSize('bookshelf');
  const pattern: Tile[] = ['bookshelf', 'drawers', 'bookshelf', 'bookshelfSmall'];
  const slots = wallSlots(w);
  let x = slots.frameX === null ? 56 : slots.frameX + FRAME_W + 12;
  const end = slots.counterX === null ? w - 48 : slots.counterX - 12;
  for (let i = 0; x + shelf.w < end; i++) {
    const name = pattern[i % pattern.length];
    const size = tileSize(name);
    tile(ctx, name, x, wallH - 4 - size.h);
    x += size.w + 12;
  }
  // Plants in the corners by the wall.
  const plant = tileSize('plant');
  drawPlant(ctx, 12, wallH - plant.h + 6, plants);
  drawPlant(ctx, w - plant.w - 12, wallH - plant.h + 6, plants);
}

/** The rug in the open area where idle characters float around. */
export function drawRug(ctx: CanvasRenderingContext2D, w: number, top: number, h: number): void {
  if (!ready()) return;
  const rug = tileSize('rug');
  if (h - top < rug.h + 8) return; // no room below the desks
  // Muted, so the bright straw mat does not fight the dark theme.
  ctx.globalAlpha = 0.45;
  tile(ctx, 'rug', w / 2 - rug.w / 2, top + (h - top - rug.h) / 2);
  ctx.globalAlpha = 1;
}

/** A desk centred on x with its top edge at y, plus the stool in front. */
export function drawDesk(ctx: CanvasRenderingContext2D, x: number, y: number): { w: number; h: number } {
  const desk = tileSize('desk');
  if (!ready()) return desk;
  tile(ctx, 'desk', x - desk.w / 2, y + 18);
  const stool = tileSize('stool');
  tile(ctx, 'stool', x - stool.w / 2, y + 18 + desk.h + 2);
  return desk;
}
