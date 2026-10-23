/** Draggable dividers between the dashboard panels. Sizes persist per viewer. */

export interface Sizes {
  side: number; // left column width (px)
  widgets: number; // right column width (px)
  floor: number; // office floor height (px); the terminal takes the rest
}

export type Edge = keyof Sizes;

export const DEFAULT_SIZES: Sizes = { side: 240, widgets: 320, floor: 260 };

const STORAGE_KEY = 'work-dashboard.layout';
const MIN_CENTER = 400;
const MIN_TERMINAL = 160;
const PADDING = 16; // #app padding top + bottom

const clamp = (v: number, min: number, max: number) => Math.round(Math.min(Math.max(v, min), Math.max(min, max)));

/** Keeps every panel usable for the given window size. */
export function clampSizes(s: Sizes, viewport: { width: number; height: number }): Sizes {
  const side = clamp(s.side, 180, 480);
  const widgets = clamp(s.widgets, 240, Math.min(720, viewport.width - MIN_CENTER - side));
  const floor = clamp(s.floor, 80, viewport.height - MIN_TERMINAL - PADDING);
  return { side, widgets, floor };
}

/** New sizes after dragging an edge by delta px (right/down positive). */
export function resize(start: Sizes, edge: Edge, delta: number, viewport: { width: number; height: number }): Sizes {
  // The widgets column sits on the right, so dragging its edge left widens it.
  const change = edge === 'widgets' ? -delta : delta;
  return clampSizes({ ...start, [edge]: start[edge] + change }, viewport);
}

export function parseSizes(raw: string | null): Sizes {
  if (!raw) return DEFAULT_SIZES;
  try {
    const v = JSON.parse(raw) as Partial<Record<Edge, unknown>>;
    const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
    if (typeof v !== 'object' || v === null) return DEFAULT_SIZES;
    const s = { side: num(v.side, NaN), widgets: num(v.widgets, NaN), floor: num(v.floor, NaN) };
    return Object.values(s).some(Number.isNaN) ? DEFAULT_SIZES : s;
  } catch {
    return DEFAULT_SIZES;
  }
}

function load(): Sizes {
  try {
    return parseSizes(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SIZES; // storage blocked: sizes just don't persist
  }
}

function save(s: Sizes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Not fatal.
  }
}

function apply(root: HTMLElement, s: Sizes) {
  root.style.setProperty('--side-w', `${s.side}px`);
  root.style.setProperty('--widgets-w', `${s.widgets}px`);
  root.style.setProperty('--floor-h', `${s.floor}px`);
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * Wires the [data-split] gutters inside root. Drag to resize, double-click to
 * reset, arrow keys for keyboard users. Returns a cleanup function.
 */
export function mountSplitters(root: HTMLElement): () => void {
  let sizes = clampSizes(load(), viewport());
  apply(root, sizes);
  const cleanups: Array<() => void> = [];

  for (const gutter of root.querySelectorAll<HTMLElement>('[data-split]')) {
    const edge = gutter.dataset.split as Edge;
    const vertical = edge === 'floor';
    gutter.tabIndex = 0;
    gutter.setAttribute('role', 'separator');
    gutter.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical');
    gutter.title = '드래그해서 크기 조절 · 더블클릭하면 기본 크기';

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      e.preventDefault();
      const start = sizes;
      const origin = vertical ? e.clientY : e.clientX;
      gutter.setPointerCapture(e.pointerId);
      document.body.classList.add(vertical ? 'resizing-row' : 'resizing-col');
      const onMove = (m: PointerEvent) => {
        sizes = resize(start, edge, (vertical ? m.clientY : m.clientX) - origin, viewport());
        apply(root, sizes);
      };
      const onUp = () => {
        gutter.removeEventListener('pointermove', onMove);
        gutter.removeEventListener('pointerup', onUp);
        gutter.removeEventListener('pointercancel', onUp);
        document.body.classList.remove('resizing-row', 'resizing-col');
        save(sizes);
      };
      gutter.addEventListener('pointermove', onMove);
      gutter.addEventListener('pointerup', onUp);
      gutter.addEventListener('pointercancel', onUp);
    };
    const onReset = () => {
      sizes = clampSizes({ ...sizes, [edge]: DEFAULT_SIZES[edge] }, viewport());
      apply(root, sizes);
      save(sizes);
    };
    const onKey = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 64 : 16;
      const keys: Record<string, number> = vertical ? { ArrowUp: -step, ArrowDown: step } : { ArrowLeft: -step, ArrowRight: step };
      if (!(e.key in keys)) return;
      e.preventDefault();
      sizes = resize(sizes, edge, keys[e.key], viewport());
      apply(root, sizes);
      save(sizes);
    };
    gutter.addEventListener('pointerdown', onDown);
    gutter.addEventListener('dblclick', onReset);
    gutter.addEventListener('keydown', onKey);
    cleanups.push(() => {
      gutter.removeEventListener('pointerdown', onDown);
      gutter.removeEventListener('dblclick', onReset);
      gutter.removeEventListener('keydown', onKey);
    });
  }

  const onWindow = () => {
    sizes = clampSizes(sizes, viewport());
    apply(root, sizes);
  };
  window.addEventListener('resize', onWindow);
  cleanups.push(() => window.removeEventListener('resize', onWindow));
  return () => cleanups.forEach((c) => c());
}
