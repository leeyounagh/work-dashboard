/**
 * UI zoom (Ctrl + / Ctrl - / Ctrl 0). Wails turns WebView2's own zoom keys
 * off, so the page zooms itself with CSS zoom on the root. Terminals are
 * excluded (xterm maps the mouse wrongly under CSS zoom) and get a larger
 * font instead; see .term-pane in app.css and TerminalPanel.setFontScale.
 */

export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8];
const KEY = 'wd.zoom';

/** The next step up (dir 1), down (-1) or back to 100% (0). */
export function stepZoom(current: number, dir: -1 | 0 | 1): number {
  if (dir === 0) return 1;
  if (dir > 0) return ZOOM_STEPS.find((s) => s > current + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((s) => s < current - 1e-6) ?? ZOOM_STEPS[0];
}

export function currentZoom(): number {
  return Number(document.documentElement.style.zoom) || 1;
}

export function loadZoom(): number {
  try {
    const z = Number(localStorage.getItem(KEY));
    return ZOOM_STEPS.includes(z) ? z : 1;
  } catch {
    return 1;
  }
}

/** Applies a zoom level, remembers it and tells the listener (terminal fonts). */
export function setZoom(z: number, onChange?: (z: number) => void): void {
  const root = document.documentElement;
  root.style.zoom = String(z);
  root.style.setProperty('--ui-zoom', String(z));
  try {
    localStorage.setItem(KEY, String(z));
  } catch {
    // Not remembered; the zoom still applies now.
  }
  onChange?.(z);
}
