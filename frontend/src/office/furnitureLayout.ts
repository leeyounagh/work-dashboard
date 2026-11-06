/**
 * Where the movable furniture stands this frame: where the user put it, or
 * its default place. Kept apart from the drawing so it can be tested.
 */
import { ITEMS, ITEM_IDS, decorId, decorIndex, isFurniture, spotToBox, type FurnitureId, type ItemId, type Size, type Spot } from './room';

/** Drawn size in CSS px of each piece. */
export const ITEM_SIZE: Record<FurnitureId, Size> = {
  plantLeft: { w: 32, h: 64 },
  plantRight: { w: 32, h: 64 },
  rug: { w: 96, h: 96 },
  bookshelf: { w: 64, h: 64 },
  sofa: { w: 78, h: 34 },
  aquarium: { w: 60, h: 40 },
};

/** Tallest a standee is drawn (CSS px); its picture keeps its proportions. */
export const DECOR_H = 96;
/** Room kept at the bottom right for the guide. */
const GUIDE_GAP = 96;

/** Drawn size of a standee picture of naturalWidth × naturalHeight. */
export function decorSize(nw: number, nh: number): Size {
  if (nw <= 0 || nh <= 0) return { w: 0, h: 0 };
  const scale = Math.min(DECOR_H / nh, DECOR_H / nw);
  return { w: Math.max(1, Math.round(nw * scale)), h: Math.max(1, Math.round(nh * scale)) };
}

export interface Box {
  id: ItemId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutInput {
  room: Size;
  wallH: number;
  deskBottom: number; // bottom of the desk rows, 0 without desks
  hasDesks: boolean;
  level: number; // furniture earned this week (vibe.officeLevel)
  spots: Partial<Record<ItemId, Spot>>;
  editing: boolean; // everything earned is shown while decorating
  decor: Size[]; // the standees' drawn sizes (0 × 0 while a picture loads)
}

/** Gap kept between the floor's bottom edge and the earned furniture. */
const FLOOR_GAP = 6;

/** Default top-left of each piece, and whether the room has space for it there. */
function defaultPlace(id: ItemId, i: LayoutInput): { x: number; y: number; fits: boolean } {
  const { w, h } = i.room;
  if (!isFurniture(id)) {
    // Along the bottom of the floor, leftward from the guide (bottom right),
    // clear of the wall's frame and counter and of the desks.
    const k = decorIndex(id);
    const size = i.decor[k];
    return { x: w - GUIDE_GAP - (k + 1) * (DECOR_H / 2 + 12), y: h - FLOOR_GAP - size.h, fits: true };
  }
  const size = ITEM_SIZE[id];
  const floorBottom = h - FLOOR_GAP;
  // The earned row along the bottom left, clear of the guide (bottom right).
  const earnedFits = h - i.deskBottom >= 80 && w >= 360;
  switch (id) {
    case 'plantLeft':
      return { x: 12, y: i.wallH - size.h + 6, fits: true };
    case 'plantRight':
      return { x: w - size.w - 12, y: i.wallH - size.h + 6, fits: true };
    case 'rug':
      // In the open area under the desks where idle characters wander.
      return {
        x: w / 2 - size.w / 2,
        y: i.deskBottom + (h - i.deskBottom - size.h) / 2,
        fits: i.hasDesks && h - i.deskBottom >= size.h + 8,
      };
    case 'bookshelf':
      return { x: 12, y: floorBottom - size.h, fits: earnedFits };
    case 'sofa':
      return { x: 80, y: floorBottom - 8 - size.h, fits: earnedFits };
    case 'aquarium':
      return { x: 168, y: floorBottom - 46, fits: earnedFits };
  }
}

const clampInto = (v: number, size: number, room: number) => Math.round(Math.min(Math.max(0, v), Math.max(0, room - size)));

/** The pieces to draw, in drawing order: the rug on the floor first, then back to front. */
export function layoutItems(i: LayoutInput): Box[] {
  const boxes: Box[] = [];
  const pieces: Array<{ id: ItemId; size: Size }> = [
    ...ITEM_IDS.filter((id) => i.level >= ITEMS[id].level).map((id) => ({ id: id as ItemId, size: ITEM_SIZE[id] })),
    ...i.decor.map((size, k) => ({ id: decorId(k) as ItemId, size })).filter((p) => p.size.w > 0 && p.size.h > 0),
  ];
  for (const { id, size } of pieces) {
    const spot = i.spots[id];
    // A piece the user placed stays where they put it (kept inside the room),
    // even where its default place would have no space.
    if (spot) {
      boxes.push({ id, ...spotToBox(spot, i.room, size), ...size });
      continue;
    }
    const place = defaultPlace(id, i);
    if (!place.fits && !i.editing) continue;
    boxes.push({ id, x: clampInto(place.x, size.w, i.room.w), y: clampInto(place.y, size.h, i.room.h), ...size });
  }
  const rank = (b: Box) => (b.id === 'rug' ? -Infinity : b.y + b.h);
  return boxes.sort((a, b) => rank(a) - rank(b));
}

/** The front-most piece under (x, y), or null. */
export function itemAt(boxes: Box[], x: number, y: number): Box | null {
  for (let k = boxes.length - 1; k >= 0; k--) {
    const b = boxes[k];
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
  }
  return null;
}
