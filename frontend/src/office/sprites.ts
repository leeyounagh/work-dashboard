/**
 * Animated characters from the CC0 "Ninja Adventure" pack (see
 * src/assets/characters/LICENSE.md). Each sheet is 4 columns (down, up, left,
 * right) × 7 rows of 16×16 frames: rows 0–3 walk, row 4 action.
 * The dog sheet is 2 frames of 16×16 side by side.
 */

export const FRAME = 16;
export type Direction = 'down' | 'up' | 'left' | 'right';

const COLUMN: Record<Direction, number> = { down: 0, up: 1, left: 2, right: 3 };
export const WALK_FRAMES = 4;
export const ACTION_ROW = 4;

export function frameRect(dir: Direction, row: number, frame = FRAME): { sx: number; sy: number } {
  return { sx: COLUMN[dir] * frame, sy: row * frame };
}

/** CSS px a character is drawn at: 16px pixel art ×3, detailed (larger) frames bigger. */
export const drawSize = (frame: number) => (frame > FRAME ? 80 : FRAME * 3);

/** Frame size of a sheet: 4 columns wide, so your own sheets may use larger frames. */
export const frameSize = (sheetWidth: number) => (sheetWidth > 0 ? sheetWidth / 4 : FRAME);

/** Which way a character faces while moving by (dx, dy). */
export function directionFor(dx: number, dy: number): Direction {
  if (dx === 0 && dy === 0) return 'down';
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** Stable small hash so a terminal keeps its character. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Claude sessions get one of the ninjas; shells are the office dog. */
export function pickSheet<T>(id: string, kind: 'claude' | 'shell', sheets: readonly T[], dog: T): T {
  if (kind === 'shell' || !sheets.length) return dog;
  return sheets[hash(id) % sheets.length];
}

// Bundled by Vite; each value is the asset URL.
const files = import.meta.glob('../assets/characters/*.png', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>;

const images = new Map<string, HTMLImageElement>();

function image(url: string): HTMLImageElement {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(url, img);
  }
  return img;
}

let custom: string[] = [];

/**
 * Uses the user's own sheets (data URLs from ~/.work-dashboard/characters,
 * same 4×7 layout, any square frame size) instead of the bundled ninjas.
 */
export function useCustomSheets(urls: string[]): void {
  custom = urls;
}

/** The character sheets and the dog, loaded lazily. */
export function sheets(): { ninjas: HTMLImageElement[]; dog: HTMLImageElement } {
  const entries = Object.entries(files);
  const dog = entries.find(([path]) => path.endsWith('/dog.png'))?.[1] ?? '';
  const bundled = entries.filter(([path]) => !path.endsWith('/dog.png')).map(([, url]) => url);
  return {
    ninjas: (custom.length ? custom : bundled).map(image),
    dog: image(dog),
  };
}
