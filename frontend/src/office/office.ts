import { DESK_H, SEAT_Y, WALL_H, bubbleFor, deskSpot, nameLabel, nextState, progressOf, type AgentState, type HookInput } from './agentState';
import { drawBookshelf, drawDesk, drawRoom, drawRug } from './background';
import { FONT, coffeeSpot, drawCelebration, drawCoffeeCounter, drawCrown, CROWN_H, CROWN_W, drawDeskClutter, drawEarnedFurniture, drawLamp, drawMvpFrame, drawNight, drawSunrise, drawSweat, wallSlots } from './decor';
import {
  CELEBRATE_MS,
  SUNRISE_MS,
  coffeeEmpty,
  coffeeLevel,
  crossedMilestone,
  cupCount,
  formatTokens,
  isReset,
  lightingFor,
  mvp,
  officeLevel,
  paperCount,
  plantHealth,
  sweating,
  type OfficeUsage,
} from './vibe';
import { QUIZ_CHANCE, QUIZ_CHECK_MS, QUIZ_GAP_MS, QUIZ_OFFER_MS, canOffer, lowUsage, pickQuizOffer, quizKind, quizQuestion, type QuizKind } from './quiz';
import { QuizBubble } from './quizBubble';
import { CROWN_FLIGHT_MS, HIGH_FIVE_MS, HIGH_FIVE_REACH, HIGH_FIVE_WALK_MS, MAX_SEEN, NO_STREAK, STREAK_BREAK_MS, advanceBanners, crownFlight } from './fun';
import { dayKey, emptyDay, freshDeploys, hopOffset, newlyEarned, nextStreak, pickHighFive, streakLevel, toDeployCards, waitingLong } from './fun';
import type { Banner, DayRecord, Streak } from './fun';
import { loadDay, saveDay } from './dayStore';
import { drawBadges, drawBanner, drawClap, drawExclaim, drawFlame } from './funDecor';
import { ACTION_ROW, FRAME, WALK_FRAMES, bobHeight, directionFor, drawSize, frameRect, frameSize, nextPose, pickSheet, poseRect, sheets, type Direction } from './sprites';

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
  mvp: '#e5c07b',
  bubble: '#e3e5e8',
  bubbleText: '#1e1f22',
  wait: '#e5c07b',
};
const FPS = 10; // pixel-art pace

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
  tokens: number; // this session's tokens since the dashboard opened it
  celebrate: { at: number; label: string } | null; // a token milestone
  wantsCoffee: boolean; // queueing at the empty pot
  finished: boolean; // Claude finished a reply since the last prompt
  streak: Streak; // working without a long break: a flame by the name
  highFive: { partner: string; met: number | null; until: number } | null;
}

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Everyone hops this long when one of my PRs is deployed. */
const CHEER_MS = 4000;

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
  /** Claude usage limits: light, coffee and plants. */
  private usage: OfficeUsage = { fiveHour: null, sevenDay: null };
  private sunriseAt = -Infinity;
  /** This week's tokens across sessions: earned furniture. */
  private week = 0;
  /** The quiz offer on screen, and when the office next looks for one. */
  private readonly quizBubble: QuizBubble;
  private offer: { id: string; until: number } | null = null;
  private nextQuizCheck = performance.now() + QUIZ_CHECK_MS;
  private quietUntil = 0;
  /** Banners across the wall (deploys, achievements), one at a time. */
  private banners: Banner[] = [];
  private cheerUntil = 0;
  /** Today's achievements and the counts behind them. */
  private day: DayRecord = loadDay();
  private nextAchievementCheck = 0;
  private dayDirty = false;
  /** The last update, to notice the window was hidden or the computer slept. */
  private lastUpdate = 0;
  /** The MVP's terminal, and the crown on its way to a new MVP. */
  private mvpId: string | null = null;
  private crown: { from: { x: number; y: number }; to: string; at: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onPick: (termId: string) => void,
    private readonly onGuide: () => void,
    private readonly onQuiz: (termId: string, kind: QuizKind) => void,
    private readonly typedSince: (termId: string, since: number) => boolean,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.quizBubble = new QuizBubble(canvas.parentElement ?? document.body);
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
      tokens: 0,
      celebrate: null,
      wantsCoffee: false,
      finished: false,
      streak: NO_STREAK,
      highFive: null,
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
        tokens: 0,
        celebrate: null,
        wantsCoffee: false,
        finished: false,
        streak: NO_STREAK,
        highFive: null,
      });
    }
  }

  private visible(): Character[] {
    return [...this.chars.values()].filter((c) => c.shown);
  }

  /** Applies a Claude hook event to its character. */
  event(termId: string, ev: HookInput): void {
    const c = this.chars.get(termId);
    if (!c) return;
    const now = performance.now();
    c.state = nextState(c.state, ev, now);
    if (ev.event === 'Stop') {
      c.finished = true;
      this.startHighFive(c, now);
    } else if (ev.event === 'UserPromptSubmit' || ev.event === 'SessionStart') c.finished = false;
  }

  /** New usage limits; a reset of the 5-hour window brings the morning. */
  setUsage(next: OfficeUsage): void {
    if (isReset(this.usage.fiveHour, next.fiveHour)) this.sunriseAt = performance.now();
    this.usage = next;
  }

  /** A session's token count; crossing a milestone sets off confetti. */
  setTokens(termId: string, tokens: number): void {
    const c = this.chars.get(termId);
    if (!c) return;
    const milestone = crossedMilestone(c.tokens, tokens);
    if (milestone !== null) c.celebrate = { at: performance.now(), label: formatTokens(milestone) };
    // Today's tokens grow by what each session adds (session counts restart with the app).
    if (tokens > c.tokens) {
      const day = this.today();
      this.day = { ...day, tokens: day.tokens + tokens - c.tokens };
      this.dayDirty = true;
    }
    c.tokens = tokens;
  }

  setWeekTokens(week: number): void {
    this.week = week;
  }

  /** New deploy cards from the Teams widget (untrusted data): a banner each, and a cheer when my PR went out. */
  deployCards(raw: unknown, me: unknown): void {
    const now = performance.now();
    const day = this.today();
    const cheers = freshDeploys(toDeployCards(raw), new Set(day.seen), typeof me === 'string' ? me : '', Date.now());
    if (!cheers.length) return;
    // Remembered for the day, so a restart does not cheer (or count) them again.
    const seen = [...new Set([...day.seen, ...cheers.map((d) => d.id)])].slice(-MAX_SEEN);
    this.day = { ...day, seen, deploys: day.deploys + cheers.length };
    saveDay(this.day);
    this.nextAchievementCheck = 0;
    this.banners = [...this.banners, ...cheers.map((d) => ({ text: d.text, at: null }))];
    if (cheers.some((d) => d.mine)) this.cheerUntil = now + CHEER_MS;
  }

  /** Today's record, started afresh after midnight. */
  private today(): DayRecord {
    const key = dayKey(new Date());
    if (this.day.day !== key) this.day = emptyDay(key);
    return this.day;
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.quizBubble.destroy();
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
    const noCoffee = coffeeEmpty(this.usage.fiveHour);
    const pot = coffeeSpot(this.width, WALL_H);
    this.updatePose(this.guide, true, now);
    // Waiting on you is a pause, not work; so is a hidden window or a sleeping computer.
    const slept = this.lastUpdate > 0 && now - this.lastUpdate >= STREAK_BREAK_MS;
    this.lastUpdate = now;
    for (const c of this.chars.values()) {
      c.streak = slept ? NO_STREAK : nextStreak(c.streak, c.term.alive && (c.state.mood === 'working' || c.state.mood === 'thinking'), now);
    }
    for (const c of this.visible()) {
      const spot = deskSpot(c.desk, this.width);
      const busy = c.state.mood !== 'idle' && c.term.alive;
      this.updatePose(c, !busy, now);
      if (busy || !noCoffee) c.wantsCoffee = false;
      if (busy) {
        // On the stool in front of the desk.
        c.tx = spot.x;
        c.ty = spot.y + SEAT_Y;
      } else if (now > c.nextWander && noCoffee && pot && Math.random() < 0.5) {
        // The pot is empty: wait by the counter for a refill (the reset).
        c.wantsCoffee = true;
        c.tx = pot.x + (Math.random() - 0.5) * 50;
        c.ty = pot.y + Math.random() * 4;
        c.nextWander = now + 5000 + Math.random() * 5000;
      } else if (now > c.nextWander) {
        c.wantsCoffee = false;
        c.tx = 30 + Math.random() * Math.max(1, this.width - 60);
        c.ty = Math.min(this.height - 22, openTop + SIZE + Math.random() * Math.max(1, this.height - openTop - SIZE - 22));
        c.nextWander = now + 3000 + Math.random() * 5000;
      }
      const dx = c.tx - c.x;
      const dy = c.ty - c.y;
      const dist = Math.hypot(dx, dy);
      const speed = busy || c.highFive ? 7 : 2.5;
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
    this.updateQuiz(now);
    this.updateHighFives(now);
    this.updateAchievements(now);
    this.banners = advanceBanners(this.banners, now);
  }

  /** A session that just finished gets a high five from the nearest idle character. */
  private startHighFive(c: Character, now: number) {
    if (!c.shown || !c.term.alive || c.highFive) return;
    const free = (o: Character) => o.term.alive && o.state.mood === 'idle' && !o.highFive && o.term.id !== this.offer?.id;
    const others = this.visible().map((o) => ({ id: o.term.id, x: o.x, y: o.y, idle: free(o) }));
    const pick = pickHighFive({ id: c.term.id, x: c.x, y: c.y, idle: true }, others);
    const p = pick && this.chars.get(pick.id);
    if (!p) return;
    const until = now + HIGH_FIVE_WALK_MS;
    c.highFive = { partner: p.term.id, met: null, until };
    p.highFive = { partner: c.term.id, met: null, until };
    // The finisher waits; the partner comes over.
    c.tx = c.x;
    c.ty = c.y;
    c.nextWander = until;
    p.nextWander = until;
    this.aimHighFive(p, c);
  }

  /** The partner heads for the finisher's side, inside the room. */
  private aimHighFive(p: Character, c: Character) {
    p.tx = Math.min(this.width - 20, Math.max(20, c.x + (p.x < c.x ? -30 : 30)));
    p.ty = c.y;
  }

  private updateHighFives(now: number) {
    for (const c of this.visible()) {
      const hf = c.highFive;
      if (!hf) continue;
      const p = this.chars.get(hf.partner);
      const end = () => {
        c.highFive = null;
        c.nextWander = now;
        if (p) {
          p.highFive = null;
          p.nextWander = now;
        }
      };
      // Either one getting back to work (or closing) calls it off.
      const free = (o: Character) => o.term.alive && o.state.mood === 'idle';
      if (!p?.highFive || !p.shown || !free(c) || !free(p)) end();
      else if (hf.met === null && now > hf.until) end();
      else if (hf.met === null && Math.hypot(p.x - c.x, p.y - c.y) <= HIGH_FIVE_REACH) {
        c.highFive = { ...hf, met: now };
        p.highFive = { ...p.highFive, met: now };
      } else if (hf.met === null) {
        // Still walking over: the partner follows the finisher if it moved.
        if (p.nextWander === hf.until) this.aimHighFive(p, c);
      } else if (hf.met !== null && now - hf.met >= HIGH_FIVE_MS) {
        end();
        this.countDay('highFives');
      }
    }
  }

  private countDay(key: 'highFives' | 'quizzes') {
    const day = this.today();
    this.day = { ...day, [key]: day[key] + 1 };
    saveDay(this.day);
    this.nextAchievementCheck = 0;
  }

  /** Every couple of seconds: a banner for each achievement newly earned today. */
  private updateAchievements(now: number) {
    if (now < this.nextAchievementCheck) return;
    this.nextAchievementCheck = now + 2000;
    const day = this.today();
    if (this.dayDirty) {
      saveDay(day);
      this.dayDirty = false;
    }
    const all = [...this.chars.values()];
    const got = newlyEarned(day.earned, {
      totalTokens: day.tokens,
      working: all.filter((c) => c.term.alive && (c.state.mood === 'working' || c.state.mood === 'thinking')).length,
      streak: Math.max(0, ...all.map((c) => streakLevel(c.streak, now))),
      highFives: this.day.highFives,
      deploys: this.day.deploys,
      quizzes: this.day.quizzes,
    });
    if (!got.length) return;
    this.day = { ...this.day, earned: [...this.day.earned, ...got.map((a) => a.id)] };
    saveDay(this.day);
    this.banners = [...this.banners, ...got.map((a) => ({ text: `${a.icon} 업적 달성: ${a.name}`, at: null }))];
  }

  /**
   * Now and then, while usage is low, a session idle for a while asks whether
   * you want a quiz. The offer goes away when it expires or the session works.
   */
  private updateQuiz(now: number) {
    if (this.offer) {
      const c = this.chars.get(this.offer.id);
      if (!c || !c.shown || now > this.offer.until || !canOffer(this.quizCandidate(c), now)) this.closeQuiz();
      else this.quizBubble.move(c.x, this.headTop(c) - 6);
      return;
    }
    if (now < this.nextQuizCheck) return;
    this.nextQuizCheck = now + QUIZ_CHECK_MS;
    if (now < this.quietUntil || !lowUsage(this.usage.fiveHour) || Math.random() >= QUIZ_CHANCE) return;
    const pick = pickQuizOffer(this.visible().map((c) => this.quizCandidate(c)), now, Math.random);
    const c = pick && this.chars.get(pick.id);
    if (!c) return;
    const kind = quizKind(c.tokens, Math.random());
    const id = c.term.id;
    this.offer = { id, until: now + QUIZ_OFFER_MS };
    this.quietUntil = now + QUIZ_GAP_MS;
    // Stands still while asking, so the bubble stays over it.
    c.tx = c.x;
    c.ty = c.y;
    c.nextWander = this.offer.until;
    this.quizBubble.show(quizQuestion(kind), c.x, this.headTop(c) - 6, (yes) => {
      this.offer = null;
      c.nextWander = performance.now();
      if (yes) {
        this.countDay('quizzes');
        this.onQuiz(id, kind);
      }
    });
  }

  private quizCandidate(c: Character) {
    const { id, kind, alive } = c.term;
    const typed = this.typedSince(id, c.state.since);
    return { id, kind, alive, mood: c.state.mood, since: c.state.since, tokens: c.tokens, finished: c.finished, typed };
  }

  private closeQuiz() {
    const c = this.offer && this.chars.get(this.offer.id);
    if (c) c.nextWander = performance.now();
    this.offer = null;
    this.quizBubble.hide();
  }

  /** Top of a character's name label. */
  private headTop(c: Character): number {
    return c.y - this.sizeOf(c) - 16;
  }

  private deskAreaBottom(): number {
    const n = this.visible().length;
    if (!n) return 0;
    return deskSpot(n - 1, this.width).y + DESK_H;
  }

  private draw(now: number) {
    const { ctx, width: w, height: h } = this;
    drawRoom(ctx, w, h, WALL_H, plantHealth(this.usage.sevenDay));
    const shown = this.visible();
    // The full tab title: several default terminals are all just "Claude" by name.
    const best = mvp(shown.map((c) => ({ c, title: c.term.title, tokens: c.tokens })));
    this.trackMvp(best?.c ?? null, now);
    this.drawWallDecor(best);
    if (shown.length) drawRug(ctx, w, this.deskAreaBottom(), h);
    // Earned furniture, only where the floor below the desks has room (clear of the guide).
    if (h - this.deskAreaBottom() >= 80 && w >= 360) drawEarnedFurniture(ctx, officeLevel(this.week), h - 6, (x, bottom) => drawBookshelf(ctx, x, bottom), this.tick);

    this.placeGuide();

    for (const c of shown) this.drawDesk(c);
    // Night falls on the room; desk lamps and the characters stay lit.
    const light = lightingFor(this.usage.fiveHour);
    drawNight(ctx, w, h, light.dark);
    if (light.lamps) for (const c of shown) this.drawDeskLamp(c);
    // Back to front so lower characters overlap higher ones.
    for (const c of [...shown, this.guide].sort((a, b) => a.y - b.y)) this.drawCharacter(c, now, c === best?.c);
    this.drawHighFives(shown, now);
    this.drawCrownFlight(now);
    drawSunrise(ctx, w, h, (now - this.sunriseAt) / SUNRISE_MS);
    const banner = this.banners[0];
    if (banner?.at != null) drawBanner(ctx, w, banner.text, now - banner.at);
  }

  /** A new MVP: the crown flies over from the old one (when both are in the room). */
  private trackMvp(best: Character | null, now: number) {
    const id = best?.term.id ?? null;
    if (id === this.mvpId) return;
    const old = this.mvpId ? this.chars.get(this.mvpId) : undefined;
    // Changed again mid-flight: it takes off from where it is now.
    const from = this.crownAt(now) ?? (old?.shown ? this.crownSpot(old) : null);
    this.crown = from && id ? { from, to: id, at: now } : null;
    this.mvpId = id;
  }

  /** Where the crown sits on a character: left of its name. */
  private crownSpot(c: Character): { x: number; y: number } {
    this.ctx.font = `bold 11px ${FONT}`;
    const half = this.ctx.measureText(short(nameLabel(c.term.title), 16)).width / 2;
    const top = Math.round(c.y - this.sizeOf(c));
    return { x: Math.round(c.x - half - CROWN_W - 6), y: top - 4 - CROWN_H + 2 };
  }

  /** The flying crown's position, or null when nothing is in flight. */
  private crownAt(now: number): { x: number; y: number } | null {
    const to = this.crown && this.chars.get(this.crown.to);
    if (!this.crown || !to?.shown) return null;
    return crownFlight(this.crown.from, this.crownSpot(to), (now - this.crown.at) / CROWN_FLIGHT_MS);
  }

  private drawCrownFlight(now: number) {
    const p = this.crownAt(now);
    // Drawn on the landing frame too: the name tag skipped it this frame.
    if (p) drawCrown(this.ctx, Math.round(p.x), Math.round(p.y), this.tick);
    if (!p || now - (this.crown?.at ?? 0) >= CROWN_FLIGHT_MS) this.crown = null;
  }

  /** Clapping hands over each pair that met for a high five. */
  private drawHighFives(shown: Character[], now: number) {
    for (const c of shown) {
      const p = c.highFive?.met != null ? this.chars.get(c.highFive.partner) : undefined;
      if (!p || c.term.id > p.term.id) continue; // once per pair
      const top = Math.min(c.y - this.sizeOf(c), p.y - this.sizeOf(p));
      drawClap(this.ctx, Math.round((c.x + p.x) / 2), Math.round(top - 30), now - (c.highFive?.met ?? now));
    }
  }

  /** The MVP frame and the coffee counter in the wall's slots. */
  private drawWallDecor(best: { title: string; tokens: number } | null) {
    const slots = wallSlots(this.width);
    if (slots.frameX !== null) {
      drawMvpFrame(this.ctx, slots.frameX, 8, best?.title ?? null, best ? formatTokens(best.tokens) : '');
      // Today's achievements under the frame.
      drawBadges(this.ctx, slots.frameX, 60, this.day.earned);
    }
    if (slots.counterX !== null) drawCoffeeCounter(this.ctx, slots.counterX, WALL_H - 2, coffeeLevel(this.usage.fiveHour), this.tick);
  }

  private drawDeskLamp(c: Character) {
    const s = deskSpot(c.desk, this.width);
    drawLamp(this.ctx, s.x, s.y);
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
    // The session's tokens pile up as paper and coffee cups.
    drawDeskClutter(ctx, s.x, s.y, paperCount(c.tokens), cupCount(c.tokens));
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

  private drawCharacter(c: Character, now: number, isMvp: boolean) {
    const { ctx } = this;
    const moving = Math.hypot(c.tx - c.x, c.ty - c.y) > 1;
    const atDesk = !moving && c.state.mood !== 'idle';
    // Idle pixel-art characters float gently.
    const lift = bobHeight(c.dog || !c.sheet.naturalWidth ? FRAME : frameSize(c.sheet.naturalWidth));
    const bob = !moving && !atDesk && c.pose === null ? Math.round(Math.sin(now / 400 + c.phase) * lift) : 0;
    const size = this.sizeOf(c);
    // Waiting on you too long, or cheering a deploy of yours: hop.
    const waitLong = waitingLong(c.state, c.term.alive, now);
    const cheer = now < this.cheerUntil && c !== this.guide && c.term.alive;
    const hop = waitLong || cheer ? hopOffset(now + c.phase * 200) : 0;
    const x = Math.round(c.x - size / 2);
    const y = Math.round(c.y - size + bob - hop);
    ctx.globalAlpha = c.term.alive ? 1 : 0.4;
    if (!moving && !atDesk) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + size / 4, Math.round(c.y), size / 2, 3);
    }
    this.drawSprite(c, moving, atDesk, x, y, size);
    ctx.globalAlpha = 1;

    // Terminal name above the head, workspace name below the feet.
    this.drawNameTag(c, y, isMvp, now);
    if (waitLong) drawExclaim(ctx, x + size - 2, y + 2, this.tick);
    ctx.textAlign = 'center';
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = COLORS.label;
    ctx.fillText(short(c.term.workspace, 16), c.x, c.y + 13);

    // Progress of the current request sits between the name and the bubble.
    const progress = c.term.alive ? progressOf(c.state, now) : null;
    if (progress) this.drawProgress(progress, c.x, y - 18);
    const bubbleBottom = progress ? y - 40 : y - 18;
    const coffee = c.wantsCoffee && !moving ? '커피…' : '';
    const text = c === this.guide ? GUIDE_BUBBLE : c.term.alive ? bubbleFor(c.state) || coffee : 'zZ';
    if (text && !(c.state.mood === 'waiting' && this.tick % 8 >= 6)) this.drawBubble(text, c.x, bubbleBottom, c.state.mood === 'waiting');

    if (atDesk && sweating(c.tokens)) drawSweat(ctx, x + size - 4, y + 4, this.tick);
    if (c.celebrate) {
      const elapsed = now - c.celebrate.at;
      if (elapsed > CELEBRATE_MS) c.celebrate = null;
      else drawCelebration(ctx, c.x, y + size / 3, c.y, elapsed, c.celebrate.label);
    }
  }

  /** The name over the head: the MVP's on a dark tag with a crown, a flame for a long work streak. */
  private drawNameTag(c: Character, y: number, isMvp: boolean, now: number) {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.font = `bold 11px ${FONT}`;
    const name = short(nameLabel(c.term.title), 16);
    const half = ctx.measureText(name).width / 2;
    if (isMvp) {
      const left = Math.round(c.x - half - CROWN_W - 6);
      ctx.fillStyle = 'rgba(20,21,24,0.8)';
      ctx.fillRect(left - 3, y - 4 - CROWN_H, Math.round(c.x + half + 4 - left + 3), CROWN_H + 4);
      // While it flies over from the old MVP, the crown is drawn in flight.
      if (this.crown?.to !== c.term.id) drawCrown(ctx, left, y - 4 - CROWN_H + 2, this.tick);
    }
    ctx.fillStyle = isMvp ? COLORS.mvp : COLORS.name;
    ctx.fillText(name, c.x, y - 4);
    const level = c === this.guide ? 0 : streakLevel(c.streak, now);
    if (level) drawFlame(ctx, Math.round(c.x + half + 4), y - 4, level, this.tick);
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
