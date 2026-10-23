/**
 * The whole UI zooms with Ctrl + / Ctrl - / Ctrl 0 (WebView2's own zoom,
 * enabled in main.go). A focused terminal would take those keys (Ctrl - is a
 * control character) and block the zoom, so they are stopped before any
 * element sees them, without preventing the browser's default.
 */

const ZOOM_KEYS = new Set(['+', '=', '-', '0']);
const ZOOM_CODES = new Set(['NumpadAdd', 'NumpadSubtract', 'Numpad0']);

export function isZoomKey(e: KeyboardEvent): boolean {
  if (!e.ctrlKey || e.altKey || e.metaKey) return false;
  return ZOOM_KEYS.has(e.key) || ZOOM_CODES.has(e.code);
}

/** Listens on the window in the capture phase; returns a function that stops it. */
export function guardZoomKeys(target: Window): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (isZoomKey(e)) e.stopPropagation();
  };
  target.addEventListener('keydown', onKey, true);
  return () => target.removeEventListener('keydown', onKey, true);
}
