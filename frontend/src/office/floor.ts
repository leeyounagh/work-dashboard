// Placeholder office floor: a pixel grid sized to the panel.
// Characters are added in a later phase.

const TILE = 16;
const FLOOR = '#25262a';
const GRID = '#2c2e33';

export function mountFloor(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');

  let frame = 0;

  const draw = () => {
    frame = 0;
    // Back the canvas with device pixels so 1px grid lines stay crisp at 125%/150% scaling.
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = FLOOR;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = GRID;
    const line = 1 / dpr;
    for (let x = 0; x < w; x += TILE) ctx.fillRect(x, 0, line, h);
    for (let y = 0; y < h; y += TILE) ctx.fillRect(0, y, w, line);
  };

  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(draw);
  };

  const observer = new ResizeObserver(schedule);
  observer.observe(canvas);

  // Redraw when the window moves to a monitor with a different scale factor.
  let dprQuery: MediaQueryList | undefined;
  const watchDpr = () => {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  };
  const onDprChange = () => {
    watchDpr();
    schedule();
  };
  watchDpr();

  return () => {
    observer.disconnect();
    dprQuery?.removeEventListener('change', onDprChange);
    if (frame !== 0) cancelAnimationFrame(frame);
  };
}
