/**
 * How the user decorated the office: the room's theme and where each piece
 * of furniture stands. Positions are fractions of the room, so they follow
 * the office as its panel is resized.
 */

export type ThemeId = 'wood' | 'oak' | 'tile' | 'carpet' | 'forest';

export type FloorStyle =
  | { kind: 'planks'; shade: number } // the tileset's wooden floor, darkened by shade (0..1)
  | { kind: 'checker'; a: string; b: string }
  | { kind: 'carpet'; base: string; fleck: string };

export interface Theme {
  id: ThemeId;
  name: string;
  floor: FloorStyle;
  wall: string;
  trim: string;
}

export const THEMES: readonly Theme[] = [
  { id: 'wood', name: '어두운 나무 (기본)', floor: { kind: 'planks', shade: 0.58 }, wall: '#2b2d31', trim: '#3a3c42' },
  { id: 'oak', name: '밝은 나무', floor: { kind: 'planks', shade: 0.35 }, wall: '#4a3b2f', trim: '#6b5442' },
  { id: 'tile', name: '체크 타일', floor: { kind: 'checker', a: '#3b3e45', b: '#30333a' }, wall: '#25323a', trim: '#3a4a54' },
  { id: 'carpet', name: '남색 카펫', floor: { kind: 'carpet', base: '#25304a', fleck: '#2e3b5a' }, wall: '#2a2833', trim: '#3d3a4a' },
  { id: 'forest', name: '숲속 사무실', floor: { kind: 'checker', a: '#2f4733', b: '#2a4030' }, wall: '#22332a', trim: '#355040' },
];

export const DEFAULT_THEME: ThemeId = 'wood';

export function themeOf(id: ThemeId): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** Furniture the user can move, and the week's tokens level (vibe.officeLevel) that brings it. */
export const ITEMS = {
  plantLeft: { name: '왼쪽 화분', level: 0 },
  plantRight: { name: '오른쪽 화분', level: 0 },
  rug: { name: '러그', level: 0 },
  bookshelf: { name: '책장', level: 1 },
  sofa: { name: '소파', level: 2 },
  aquarium: { name: '수족관', level: 3 },
} as const;

export type ItemId = keyof typeof ITEMS;

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

/** Where an item stands: its centre x and its bottom y, as fractions of the room. */
export interface Spot {
  fx: number;
  fy: number;
}

export interface RoomPrefs {
  theme: ThemeId;
  spots: Partial<Record<ItemId, Spot>>; // only the items the user moved
}

export const DEFAULT_PREFS: RoomPrefs = { theme: DEFAULT_THEME, spots: {} };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const isThemeId = (v: unknown): v is ThemeId => typeof v === 'string' && THEMES.some((t) => t.id === v);

function parseSpot(v: unknown): Spot | null {
  if (!v || typeof v !== 'object') return null;
  const { fx, fy } = v as Record<string, unknown>;
  if (typeof fx !== 'number' || typeof fy !== 'number' || !Number.isFinite(fx) || !Number.isFinite(fy)) return null;
  return { fx: clamp01(fx), fy: clamp01(fy) };
}

/** Saved preferences (untrusted storage): anything unknown or broken falls back to the default. */
export function parsePrefs(raw: string | null): RoomPrefs {
  if (!raw) return DEFAULT_PREFS;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFS;
  }
  if (!data || typeof data !== 'object') return DEFAULT_PREFS;
  const { theme, spots } = data as Record<string, unknown>;
  const out: Partial<Record<ItemId, Spot>> = {};
  if (spots && typeof spots === 'object') {
    for (const id of ITEM_IDS) {
      const spot = parseSpot((spots as Record<string, unknown>)[id]);
      if (spot) out[id] = spot;
    }
  }
  return { theme: isThemeId(theme) ? theme : DEFAULT_THEME, spots: out };
}

export const withTheme = (p: RoomPrefs, theme: ThemeId): RoomPrefs => ({ ...p, theme });

export const withSpot = (p: RoomPrefs, id: ItemId, spot: Spot): RoomPrefs => ({
  ...p,
  spots: { ...p.spots, [id]: { fx: clamp01(spot.fx), fy: clamp01(spot.fy) } },
});

export const withoutSpots = (p: RoomPrefs): RoomPrefs => ({ ...p, spots: {} });

export interface Size {
  w: number;
  h: number;
}

/** Top-left in px of an item of the given size standing at spot, kept inside the room. */
export function spotToBox(spot: Spot, room: Size, item: Size): { x: number; y: number } {
  const x = Math.min(Math.max(0, spot.fx * room.w - item.w / 2), Math.max(0, room.w - item.w));
  const y = Math.min(Math.max(0, spot.fy * room.h - item.h), Math.max(0, room.h - item.h));
  return { x: Math.round(x), y: Math.round(y) };
}

/** The spot for an item whose top-left is at (x, y). */
export function boxToSpot(x: number, y: number, room: Size, item: Size): Spot {
  if (room.w <= 0 || room.h <= 0) return { fx: 0.5, fy: 1 };
  return { fx: clamp01((x + item.w / 2) / room.w), fy: clamp01((y + item.h) / room.h) };
}
