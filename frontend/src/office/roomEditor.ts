/**
 * Decorating the office: a 「꾸미기」 button over the canvas opens a toolbar
 * to pick the theme, and while it is open the furniture can be dragged
 * around. The choices are kept in this browser's storage.
 */
import { itemAt, type Box } from './furnitureLayout';
import { DEFAULT_PREFS, THEMES, boxToSpot, parsePrefs, withSpot, withTheme, withoutSpots, type ItemId, type RoomPrefs, type Size, type ThemeId } from './room';

const STORAGE_KEY = 'work-dashboard.room';

function loadRoom(): RoomPrefs {
  try {
    return parsePrefs(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

function saveRoom(p: RoomPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable: the decoration lasts until the app closes.
  }
}

/** What the editor needs from the office. */
export interface RoomView {
  boxes(): Box[];
  point(e: MouseEvent): { x: number; y: number }; // canvas CSS px
  room(): Size;
  redraw(): void;
}

export class RoomEditor {
  prefs: RoomPrefs = loadRoom();
  editing = false;
  /** The piece under the pointer or being dragged. */
  active: ItemId | null = null;
  private drag: { id: ItemId; offX: number; offY: number; size: Size; pointer: number } | null = null;
  private readonly toggle: HTMLButtonElement;
  private readonly bar: HTMLDivElement;
  private readonly cleanups: Array<() => void> = [];

  constructor(
    host: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly view: RoomView,
  ) {
    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.toggle.className = 'room-toggle';
    this.toggle.textContent = '🎨 꾸미기';
    this.toggle.title = '사무실 테마를 고르고 가구를 옮깁니다';
    this.toggle.addEventListener('click', () => this.setEditing(true));
    this.bar = this.toolbar();
    host.append(this.toggle, this.bar);

    const down = (e: PointerEvent) => this.onDown(e);
    const move = (e: PointerEvent) => this.onMove(e);
    const up = (e: PointerEvent) => this.onUp(e);
    const key = (e: KeyboardEvent) => {
      if (!this.editing || e.key !== 'Escape' || e.defaultPrevented) return;
      // Only from the office itself: Esc typed in a terminal or a field is theirs.
      const t = e.target;
      if (t !== document.body && t !== canvas && !(t instanceof Node && this.bar.contains(t))) return;
      this.setEditing(false);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    document.addEventListener('keydown', key);
    this.cleanups.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('lostpointercapture', up);
      document.removeEventListener('keydown', key);
    });
  }

  private toolbar(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.className = 'room-bar';
    bar.hidden = true;
    const select = document.createElement('select');
    select.className = 'field';
    select.setAttribute('aria-label', '사무실 테마');
    for (const t of THEMES) select.append(new Option(t.name, t.id, false, t.id === this.prefs.theme));
    select.addEventListener('change', () => this.update(withTheme(this.prefs, select.value as ThemeId)));
    const hint = document.createElement('span');
    hint.className = 'room-hint';
    hint.textContent = '가구를 끌어서 옮기세요';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = '배치 초기화';
    reset.title = '옮긴 가구를 원래 자리로 돌립니다 (테마는 그대로)';
    reset.addEventListener('click', () => this.update(withoutSpots(this.prefs)));
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'primary';
    done.textContent = '완료';
    done.addEventListener('click', () => this.setEditing(false));
    bar.append(select, hint, reset, done);
    return bar;
  }

  private update(next: RoomPrefs) {
    this.prefs = next;
    saveRoom(next);
    this.view.redraw();
  }

  private setEditing(on: boolean) {
    // A piece still held when decorating ends stays where it was dropped.
    if (this.drag) saveRoom(this.prefs);
    this.editing = on;
    this.toggle.hidden = on;
    this.bar.hidden = !on;
    this.drag = null;
    this.active = null;
    this.canvas.style.cursor = 'default';
    this.view.redraw();
  }

  private onDown(e: PointerEvent) {
    if (!this.editing || e.button !== 0) return;
    const p = this.view.point(e);
    const hit = itemAt(this.view.boxes(), p.x, p.y);
    if (!hit) return;
    e.preventDefault();
    this.drag = { id: hit.id, offX: p.x - hit.x, offY: p.y - hit.y, size: { w: hit.w, h: hit.h }, pointer: e.pointerId };
    this.active = hit.id;
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = 'grabbing';
  }

  private onMove(e: PointerEvent) {
    if (!this.editing) return;
    const p = this.view.point(e);
    const d = this.drag;
    if (d && e.pointerId === d.pointer) {
      // Not saved on every move: once, when the piece is let go.
      this.prefs = withSpot(this.prefs, d.id, boxToSpot(p.x - d.offX, p.y - d.offY, this.view.room(), d.size));
      this.view.redraw();
      return;
    }
    const hit = itemAt(this.view.boxes(), p.x, p.y);
    if ((hit?.id ?? null) !== this.active) {
      this.active = hit?.id ?? null;
      this.view.redraw();
    }
    this.canvas.style.cursor = hit ? 'grab' : 'default';
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.style.cursor = 'grab';
    saveRoom(this.prefs);
  }

  destroy(): void {
    for (const off of this.cleanups) off();
    this.toggle.remove();
    this.bar.remove();
  }
}
