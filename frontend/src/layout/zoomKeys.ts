/**
 * Ctrl + / Ctrl - / Ctrl 0 zoom the UI (see zoom.ts). The keys are caught on
 * the window before any element, so a focused terminal (where Ctrl - is a
 * control character) cannot swallow them.
 */

const KEYS: Record<string, 1 | -1 | 0> = { '+': 1, '=': 1, '-': -1, '0': 0 };
const CODES: Record<string, 1 | -1 | 0> = { NumpadAdd: 1, NumpadSubtract: -1, Numpad0: 0 };

/** 1 = zoom in, -1 = out, 0 = reset; undefined when it is not a zoom key. */
export function zoomDirection(e: KeyboardEvent, mac = false): 1 | -1 | 0 | undefined {
  // Cmd on macOS, Ctrl elsewhere.
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey) return undefined;
  return CODES[e.code] ?? KEYS[e.key];
}

/** Listens on the window in the capture phase; returns a function that stops it. */
export function guardZoomKeys(target: Window, onZoom: (dir: 1 | -1 | 0) => void, mac = false): () => void {
  const onKey = (e: KeyboardEvent) => {
    const dir = zoomDirection(e, mac);
    if (dir === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    onZoom(dir);
  };
  target.addEventListener('keydown', onKey, true);
  return () => target.removeEventListener('keydown', onKey, true);
}
