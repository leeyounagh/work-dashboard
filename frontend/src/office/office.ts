import { DESK_H, SEAT_Y, WALL_H, bubbleFor, deskSpot, nameLabel, nextState, progressOf, type AgentState, type HookInput } from './agentState';
import { drawDesk, drawRoom, drawRug } from './background';
import { ACTION_ROW, FRAME, WALK_FRAMES, directionFor, drawSize, frameRect, frameSize, nextPose, pickSheet, poseRect, sheets, type Direction } from './sprites';

/** A terminal as the office sees it. */
export interface OfficeTerminal {
  id: string;
  title: string; // terminal (tab) name, shown above the character
  workspace: string; // workspace name, shown below
  workspaceId: string;
  kind: 'claude' | 'shell';
  alive: boolean;
}

const SCALE = 3; // CSS px per sprite pixel
const SIZE = FRAME * SCALE;
const COLORS = {
  monitor: '#1b1c1f',
  screenIdle: '#2e3a4f',
  screenWork: '#d4a27f',
  screenWait: '#e5c07b',
  name: '#e3e5e8',
  label: '#9aa0a6',
  bubble: '#e3e5e8',
  bubbleText: '#1e1f22',
  wait: '#e5c07b',
};
const FPS = 10; // pixel-art pace
const FONT = '"Segoe UI", "Malgun Gothic", sans-serif';

interface Character {
  term: OfficeTerminal;
  state: AgentState;
  sheet: HTMLImageElement;
  dog: boolean;
  dir: Direction;
  desk: number;
  shown: boolean; // in the selected workspace
  x: number;
  y: number;
  tx: number;
  ty: number;
  nextWander: number;
  phase: number;
  // An idle pose from rows 5–6 of your own sheets, held until poseUntil.
  pose: number | null;
  poseUntil: number;
  nextPoseAt: number;
}

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const GUIDE_ID = 'office-guide';
const GUIDE_BUBBLE = '읽을거리';

export class Office {
  private readonly chars = new Map<string, Character>();
  private readonly ctx: CanvasRenderingContext2D;
  private art = sheets();
  private frame = 0;
  private last = 0;
  private tick = 0;
  private width = 0;
  private height = 0;
  private readonly observer: ResizeObserver;
  private readonly cleanups: Array<() => void> = [];
  /** Always in the office; clicking it suggests something to read. */
  private guide: Character = this.newGuide();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onPick: (termId: string) => void,
    private readonly onGuide: () => void,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();

    const onClick = (e: MouseEvent) => {
      const hit = this.hitTest(e);
      if (hit === this.guide) this.onGuide();
      else if (hit) this.onPick(hit.term.id);
    };
    const onMove = (e: MouseEvent) => {
      const hit = this.hitTest(e);
      canvas.style.cursor = hit ? 'pointer' : 'default';
      if (hit === this.guide) canvas.title = '가이드 — 클릭하면 이 워크스페이스 기술에 맞는 블로그 · 아티클을 엽니다';
      else canvas.title = hit ? `${hit.term.title} — 클릭하면 터미널로 이동` : '';
    };
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mousemove', onMove);
    this.cleanups.push(() => {
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMove);
    });
    this.frame = requestAnimationFrame((t) => this.loop(t));
  }

  private newGuide(): Character {
    const term: OfficeTerminal = { id: GUIDE_ID, title: '가이드', workspace: '', workspaceId: '', kind: 'claude', alive: true };
    // The user's guide.png, else the last character sheet.
    const sheet = this.art.guide ?? this.art.ninjas.at(-1) ?? this.art.dog;
    return {
      term,
      state: { mood: 'idle', tool: '', since: 0 },
      sheet,
      dog: sheet === this.art.dog,
      dir: 'down',
      desk: -1,
      shown: true,
      x: 0,
      y: 0,
      tx: 0,
      ty: 0,
      nextWander: 0,
      phase: 0,
      pose: null,
      poseUntil: 0,
      nextPoseAt: performance.now() + 2000,
    };
  }

  /** The guide stands at the bottom right of the floor. */
  private placeGuide() {
    const x = Math.max(SIZE, this.width - 56);
    // By the bottom edge, so a short office never hides it below the floor.
    const y = this.height - 26;
    this.guide = { ...this.guide, x, y, tx: x, ty: y };
  }

  /** Reloads the character sheets (after custom sprites were found). */
  reloadArt(): void {
    this.art = sheets();
    this.guide = { ...this.newGuide(), x: this.guide.x, y: this.guide.y, tx: this.guide.tx, ty: this.guide.ty };
    for (const c of this.chars.values()) {
      if (!c.dog) c.sheet = pickSheet(c.term.id, c.term.kind, this.art.ninjas, this.art.dog);
    }
  }

  /**
   * Keeps one character per terminal. Every terminal keeps its state (so hook
   * events for other workspaces are not lost); only the selected workspace's
   * characters are shown, at desks numbered among themselves.
   */
  sync(terminals: OfficeTerminal[], workspaceId: string | null): void {
    const ids = new Set(terminals.map((t) => t.id));
    for (const id of [...this.chars.keys()]) if (!ids.has(id)) this.chars.delete(id);
    let desk = 0;
    for (const term of terminals) {
      const shown = term.workspaceId === workspaceId;
      const i = shown ? desk++ : 0;
      const existing = this.chars.get(term.id);
      if (existing) {
        existing.term = term;
        existing.desk = i;
        existing.shown = shown;
        continue;
      }
      const spot = deskSpot(i, this.width);
      const sheet = pickSheet(term.id, term.kind, this.art.ninjas, this.art.dog);
      this.chars.set(term.id, {
        term,
        state: { mood: 'idle', tool: '', since: performance.now() },
        sheet,
        dog: sheet === this.art.dog,
        dir: 'down',
        desk: i,
        shown,
        x: spot.x,
        y: this.height - 30,
        tx: spot.x,
        ty: this.height - 30,
        nextWander: 0,
        phase: Math.random() * Math.PI * 2,
        pose: null,
        poseUntil: 0,
        nextPoseAt: performance.now() + 3000 + Math.random() * 8000,
      });
    }
  }

  private visible(): Character[] {
    return [...this.chars.values()].filter((c) => c.shown);
  }

  /** Applies a Claude hook event to its character. */
  event(termId: string, ev: HookInput): void {
    const c = this.chars.get(termId);
    if (c) c.state = nextState(c.state, ev, performance.now());
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    for (const off of this.cleanups) off();
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    const bw = Math.round(this.width * dpr);
    const bh = Math.round(this.height * dpr);
    const changed = this.canvas.width !== bw || this.canvas.height !== bh;
    if (changed) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    // Resizing clears the canvas; draw now instead of at the next (10 fps)
    // frame, or dragging a splitter flickers.
    if (changed) this.draw(performance.now());
  }

  private hitTest(e: MouseEvent): Character | undefined {
    const r = this.canvas.getBoundingClientRect();
    // Under the UI zoom the box is scaled; map back to canvas (CSS) pixels.
    const sx = r.width ? this.width / r.width : 1;
    const sy = r.height ? this.height / r.height : 1;
    const x = (e.clientX - r.left) * sx;
    const y = (e.clientY - r.top) * sy;
    // Front-most (lowest) character first, matching the drawing order.
    return [...this.visible(), this.guide]
      .sort((a, b) => b.y - a.y)
      .find((c) => {
        const size = this.sizeOf(c);
        return Math.abs(x - c.x) < size / 2 && y > c.y - size && y < c.y + 4;
      });
  }

  /** Drawn size of a character: the dog and pixel art 48px, detailed sheets bigger. */
  private sizeOf(c: Character): number {
    return c.dog || !c.sheet.naturalWidth ? SIZE : drawSize(frameSize(c.sheet.naturalWidth));
  }

  private loop(t: number) {
    this.frame = requestAnimationFrame((n) => this.loop(n));
    if (t - this.last < 1000 / FPS) return;
    this.last = t;
    this.tick++;
    this.update(t);
    this.draw(t);
  }

  /**
   * Idle characters drawn from your own sheets sometimes stop and strike a
   * random pose (rows 5–6) for a few seconds. The bundled pixel sheets use
   * those rows for other things, so they keep walking only.
   */
  private updatePose(c: Character, idle: boolean, now: number) {
    const own = c.sheet.src.startsWith('data:');
    if (!own || !idle || c.dog) {
      c.pose = null;
      return;
    }
    if (c.pose !== null && now >= c.poseUntil) c.pose = null;
    const standing = Math.hypot(c.tx - c.x, c.ty - c.y) <= 1;
    if (c.pose === null && standing && now >= c.nextPoseAt) {
      const p = nextPose(now);
      c.pose = p.pose;
      c.poseUntil = p.until;
      c.nextPoseAt = p.next;
    }
    // Holding a pose: no wandering off until it is over.
    if (c.pose !== null) c.nextWander = Math.max(c.nextWander, c.poseUntil);
  }

  /** Busy characters go to their desk; idle ones float around the open floor. */
  private update(now: number) {
    const openTop = this.deskAreaBottom() + 30;
    this.updatePose(this.guide, true, now);
    for (const c of this.visible()) {
      const spot = deskSpot(c.desk, this.width);
      const busy = c.state.mood !== 'idle' && c.term.alive;
      this.updatePose(c, !busy, now);
      if (busy) {
        // On the stool in front of the desk.
        c.tx = spot.x;
        c.ty = spot.y + SEAT_Y;
      } else if (now > c.nextWander) {
        c.tx = 30 + Math.random() * Math.max(1, this.width - 60);
        c.ty = Math.min(this.height - 22, openTop + SIZE + Math.random() * Math.max(1, this.height - openTop - SIZE - 22));
        c.nextWander = now + 3000 + Math.random() * 5000;
      }
      const dx = c.tx - c.x;
      const dy = c.ty - c.y;
      const dist = Math.hypot(dx, dy);
      const speed = busy ? 7 : 2.5;
      if (dist > speed) {
        c.x += (dx / dist) * speed;
        c.y += (dy / dist) * speed;
        c.dir = directionFor(dx, dy);
      } else {
        c.x = c.tx;
        c.y = c.ty;
        // At the desk the character faces the monitor.
        if (busy) c.dir = 'up';
      }
    }
  }

  private deskAreaBottom(): number {
    const n = this.visible().length;
    if (!n) return 0;
    return deskSpot(n - 1, this.width).y + DESK_H;
  }

  private draw(now: number) {
    const { ctx, width: w, height: h } = this;
    drawRoom(ctx, w, h, WALL_H);
    const shown = this.visible();
    if (shown.length) drawRug(ctx, w, this.deskAreaBottom(), h);

    this.placeGuide();

    for (const c of shown) this.drawDesk(c);
    // Back to front so lower characters overlap higher ones.
    for (const c of [...shown, this.guide].sort((a, b) => a.y - b.y)) this.drawCharacter(c, now);
  }

  private drawDesk(c: Character) {
    const { ctx } = this;
    const s = deskSpot(c.desk, this.width);
    drawDesk(ctx, s.x, s.y);
    // The monitor on the desk shows the character's state.
    const x = Math.round(s.x - 12);
    const y = Math.round(s.y + 4);
    ctx.fillStyle = COLORS.monitor;
    ctx.fillRect(x - 2, y, 28, 18);
    const mood = c.term.alive ? c.state.mood : 'idle';
    const blink = this.tick % 8 < 4;
    ctx.fillStyle = mood === 'working' ? COLORS.screenWork : mood === 'waiting' && blink ? COLORS.screenWait : COLORS.screenIdle;
    ctx.fillRect(x, y + 2, 24, 12);
  }

  private drawSprite(c: Character, moving: boolean, atDesk: boolean, x: number, y: number, size: number) {
    const { ctx } = this;
    if (!c.sheet.complete || !c.sheet.naturalWidth) return; // still loading
    if (c.dog) {
      // Two frames side by side, facing left; mirror when going right.
      const sx = (moving || this.tick % 6 < 3 ? this.tick % 2 : 0) * FRAME;
      ctx.save();
      if (c.dir === 'right') {
        ctx.translate(x + SIZE, y);
        ctx.scale(-1, 1);
        ctx.drawImage(c.sheet, sx, 0, FRAME, FRAME, 0, 0, SIZE, SIZE);
      } else {
        ctx.drawImage(c.sheet, sx, 0, FRAME, FRAME, x, y, SIZE, SIZE);
      }
      ctx.restore();
      return;
    }
    let row = 0;
    if (moving) row = this.tick % WALK_FRAMES;
    else if (atDesk && c.state.mood === 'working') row = this.tick % 2 ? ACTION_ROW : 0;
    const frame = frameSize(c.sheet.naturalWidth);
    const { sx, sy } = c.pose !== null && !moving ? poseRect(c.pose, frame) : frameRect(c.dir, row, frame);
    // Pixel art stays crisp; larger drawn frames (your own sheets) are smoothed when shrunk.
    ctx.imageSmoothingEnabled = frame > FRAME;
    ctx.drawImage(c.sheet, sx, sy, frame, frame, x, y, size, size);
    ctx.imageSmoothingEnabled = false;
  }

  private drawCharacter(c: Character, now: number) {
    const { ctx } = this;
    const moving = Math.hypot(c.tx - c.x, c.ty - c.y) > 1;
    const atDesk = !moving && c.state.mood !== 'idle';
    // Idle characters float gently.
    const bob = !moving && !atDesk && c.pose === null ? Math.round(Math.sin(now / 400 + c.phase) * 3) : 0;
    const size = this.sizeOf(c);
    const x = Math.round(c.x - size / 2);
    const y = Math.round(c.y - size + bob);
    ctx.globalAlpha = c.term.alive ? 1 : 0.4;
    if (!moving && !atDesk) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + size / 4, Math.round(c.y), size / 2, 3);
    }
    this.drawSprite(c, moving, atDesk, x, y, size);
    ctx.globalAlpha = 1;

    // Terminal name above the head, workspace name below the feet.
    ctx.textAlign = 'center';
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillStyle = COLORS.name;
    ctx.fillText(short(nameLabel(c.term.title), 16), c.x, y - 4);
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = COLORS.label;
    ctx.fillText(short(c.term.workspace, 16), c.x, c.y + 13);

    // Progress of the current request sits between the name and the bubble.
    const progress = c.term.alive ? progressOf(c.state, now) : null;
    if (progress) this.drawProgress(progress, c.x, y - 18);
    const bubbleBottom = progress ? y - 40 : y - 18;
    const text = c === this.guide ? GUIDE_BUBBLE : c.term.alive ? bubbleFor(c.state) : 'zZ';
    if (text && !(c.state.mood === 'waiting' && this.tick % 8 >= 6)) this.drawBubble(text, c.x, bubbleBottom, c.state.mood === 'waiting');
  }

  /** A small bar (to-do fraction) and a label (2/5 step, or tools · time) above the name. */
  private drawProgress(p: { fraction: number | null; text: string }, cx: number, bottom: number) {
    const { ctx } = this;
    const w = 64;
    const x = Math.round(cx - w / 2);
    if (p.fraction !== null) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x, bottom - 6, w, 5);
      ctx.fillStyle = '#73c991';
      ctx.fillRect(x, bottom - 6, Math.round(w * Math.min(1, p.fraction)), 5);
    }
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = 'center';
    const label = short(p.text, 18);
    const tw = ctx.measureText(label).width + 8;
    ctx.fillStyle = 'rgba(20,21,24,0.75)';
    ctx.fillRect(Math.round(cx - tw / 2), bottom - 20, Math.round(tw), 13);
    ctx.fillStyle = '#e3e5e8';
    ctx.fillText(label, cx, bottom - 10);
  }

  private drawBubble(text: string, cx: number, bottom: number, alert: boolean) {
    const { ctx } = this;
    ctx.font = '10px "Cascadia Mono", Consolas, monospace';
    const label = short(text, 14);
    const w = Math.round(Math.min(ctx.measureText(label).width, 90) + 10);
    const x = Math.round(cx - w / 2);
    const y = bottom - 16;
    ctx.fillStyle = alert ? COLORS.wait : COLORS.bubble;
    ctx.fillRect(x, y, w, 14);
    ctx.fillRect(Math.round(cx) - 2, y + 14, 4, 3); // tail
    ctx.fillStyle = COLORS.bubbleText;
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, y + 10);
  }
}
