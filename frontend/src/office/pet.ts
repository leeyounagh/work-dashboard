/**
 * The office pet: the user's own Petdex-style sheet (~/.work-dashboard/pets)
 * that does no work. It ambles about the floor, lounges on the sofa when
 * nobody is working, watches whoever is on a work streak, pokes a character
 * left waiting on you, looks at the standees, and waves when clicked. With
 * several pets, the others now and then follow the first (the leader) and
 * curl up beside it when it lounges.
 *
 * Kept free of drawing so the behaviour can be tested.
 */

/** Petdex sheet layout: 8 columns × 9 rows; each row an animation. */
export const PET_COLS = 8;
export const PET_ROWS = 9;

export type PetAnim = 'idle' | 'runRight' | 'runLeft' | 'wave' | 'jump' | 'sad' | 'wait';

/** Row and frame count of each animation used here (Petdex: idle, run right, run left, wave, jump, failed, waiting, …). */
export const PET_ANIMS: Record<PetAnim, { row: number; frames: number }> = {
  idle: { row: 0, frames: 6 },
  runRight: { row: 1, frames: 8 },
  runLeft: { row: 2, frames: 8 },
  wave: { row: 3, frames: 4 },
  jump: { row: 4, frames: 5 },
  sad: { row: 5, frames: 8 },
  wait: { row: 6, frames: 6 },
};

/** What the pet is up to: where it goes, and what it does once there. */
export type PetAct = 'wander' | 'lounge' | 'watch' | 'poke' | 'look' | 'wave' | 'follow';

export interface Pet {
  x: number; // feet
  y: number;
  tx: number;
  ty: number;
  act: PetAct;
  /** The character it went to (watch, poke), so it can give up when that one moves on. */
  target: string | null;
  until: number; // when it picks something else to do
  face: 1 | -1; // right or left
  line: string | null; // what it is saying
  lineUntil: number;
}

export interface Point {
  x: number;
  y: number;
}

/** What the pet can see this frame. */
export interface PetWorld {
  floor: { left: number; right: number; top: number; bottom: number }; // where its feet may go
  sofa: Point | null; // the seat, when the sofa is in the room
  standees: Point[]; // in front of each standee
  streakers: Array<Point & { id: string }>; // characters on a work streak
  waiting: Array<Point & { id: string }>; // characters left waiting on you too long
  allIdle: boolean; // no session is working
  /** The pet this one follows (the first one on screen), if it is not that one itself. */
  leader?: (Point & { lounging: boolean; slot: number }) | null; // slot: 1 for the first follower, 2 …
}

export const PET_SPEED = 2.2; // px per frame (10 fps): a stroll
export const WAVE_MS = 2500;
export const LINE_MS = 3500;
const NEAR = 28; // how far beside a character it stands
/** The target of a pet that follows or curls up by the leader. */
const LEADER = 'leader';
/** How far apart a follower keeps from the leader (and from the follower before it), and how far behind. */
const FOLLOW_GAP = 44;
const FOLLOW_BEHIND = 6;
/** Following a pet that got this far ahead, it hurries. */
const CATCH_UP = 2 * FOLLOW_GAP;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function newPet(at: Point, now: number): Pet {
  return { x: at.x, y: at.y, tx: at.x, ty: at.y, act: 'wander', target: null, until: now, face: 1, line: null, lineUntil: 0 };
}

const inside = (w: PetWorld, p: Point): Point => ({
  x: clamp(p.x, w.floor.left, w.floor.right),
  y: clamp(p.y, w.floor.top, w.floor.bottom),
});

/** Beside someone, on the side the pet comes from. */
const beside = (pet: Pet, w: PetWorld, p: Point): Point => inside(w, { x: p.x + (pet.x < p.x ? -NEAR : NEAR), y: p.y });

/** A follower's place by the leader: a row of slots on one side, the other side at a wall. */
function followSpot(pet: Pet, w: PetWorld, lead: NonNullable<PetWorld['leader']>): Point {
  const gap = FOLLOW_GAP * Math.max(1, lead.slot);
  // Keep the side it chose unless it is clearly past the leader, so it does not hop across.
  const kept: 1 | -1 = pet.tx < lead.x ? -1 : 1;
  let side: 1 | -1 = pet.x < lead.x - 4 ? -1 : pet.x > lead.x + 4 ? 1 : kept;
  const x = lead.x + side * gap;
  if (x < w.floor.left || x > w.floor.right) side = side === 1 ? -1 : 1;
  // A step behind (higher up), so the leader is drawn in front of it.
  return inside(w, { x: lead.x + side * gap, y: lead.y - FOLLOW_BEHIND });
}

const pickOne = <T>(list: readonly T[], rnd: () => number): T => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];

/** Something new to do. */
export function planPet(pet: Pet, w: PetWorld, now: number, rnd: () => number = Math.random): Pet {
  const go = (act: PetAct, to: Point, ms: number, target: string | null = null): Pet => ({ ...pet, act, target, tx: to.x, ty: to.y, until: now + ms });
  if (w.waiting.length && rnd() < 0.6) {
    const c = pickOne(w.waiting, rnd);
    return go('poke', beside(pet, w, c), 9000, c.id);
  }
  const lead = w.leader;
  if (lead?.lounging && rnd() < 0.8) return go('lounge', followSpot(pet, w, lead), 15000, LEADER);
  if (lead && rnd() < 0.45) return go('follow', followSpot(pet, w, lead), 8000 + rnd() * 4000, LEADER);
  if (w.allIdle && rnd() < 0.7) return go('lounge', w.sofa ? inside(w, w.sofa) : { x: pet.x, y: pet.y }, 15000);
  if (w.streakers.length && rnd() < 0.35) {
    const c = pickOne(w.streakers, rnd);
    return go('watch', beside(pet, w, c), 8000, c.id);
  }
  if (w.standees.length && rnd() < 0.25) return go('look', inside(w, pickOne(w.standees, rnd)), 6000);
  const to = {
    x: w.floor.left + rnd() * Math.max(0, w.floor.right - w.floor.left),
    y: w.floor.top + rnd() * Math.max(0, w.floor.bottom - w.floor.top),
  };
  return go('wander', to, 4000 + rnd() * 5000);
}

/** Whether the character the pet went to is still worth being there for. */
function targetGone(pet: Pet, w: PetWorld): boolean {
  if (pet.act === 'poke') return !w.waiting.some((c) => c.id === pet.target);
  if (pet.act === 'watch') return !w.streakers.some((c) => c.id === pet.target);
  if (pet.act === 'follow') return !w.leader;
  return false;
}

/** One frame: pick something new when it is time, then walk toward the goal. */
export function stepPet(pet: Pet, w: PetWorld, now: number, rnd: () => number = Math.random): Pet {
  // The room may have shrunk since the goal was picked: stay on the floor.
  const at = inside(w, pet);
  const goal = inside(w, { x: pet.tx, y: pet.ty });
  let p: Pet = { ...pet, x: at.x, y: at.y, tx: goal.x, ty: goal.y };
  if (p.line !== null && now >= p.lineUntil) p = { ...p, line: null };
  if (now >= p.until || targetGone(p, w)) p = planPet(p, w, now, rnd);
  // Following, or curling up by a leader still on its way to the sofa: keep by it as it moves.
  if (p.target === LEADER && w.leader && (p.act === 'follow' || w.leader.lounging)) {
    const to = followSpot(p, w, w.leader);
    p = { ...p, tx: to.x, ty: to.y };
  }
  const dx = p.tx - p.x;
  const dy = p.ty - p.y;
  const dist = Math.hypot(dx, dy);
  const speed = p.act === 'follow' && dist > CATCH_UP ? PET_SPEED * 1.5 : PET_SPEED;
  if (dist <= speed) return { ...p, x: p.tx, y: p.ty };
  return {
    ...p,
    x: p.x + (dx / dist) * speed,
    y: p.y + (dy / dist) * speed,
    face: dx > 0.5 ? 1 : dx < -0.5 ? -1 : p.face,
  };
}

/** Clicked: it stops, waves and says one of its lines (if it has any). */
export function clickPet(pet: Pet, lines: readonly string[], now: number, rnd: () => number = Math.random): Pet {
  const line = lines.length ? pickOne(lines, rnd) : null;
  return { ...pet, act: 'wave', target: null, tx: pet.x, ty: pet.y, until: now + WAVE_MS, line, lineUntil: now + LINE_MS };
}

/** The animation for what the pet is doing right now. */
export function petAnim(pet: Pet): PetAnim {
  if (Math.hypot(pet.tx - pet.x, pet.ty - pet.y) > 0.5) return pet.tx >= pet.x ? 'runRight' : 'runLeft';
  switch (pet.act) {
    case 'wave':
      return 'wave';
    case 'poke':
      return 'jump';
    case 'lounge':
      return 'wait';
    default:
      return 'idle';
  }
}

/** Where in the sheet this tick's frame is (in frames, not px). */
export function petFrame(anim: PetAnim, tick: number): { col: number; row: number } {
  const a = PET_ANIMS[anim];
  return { col: tick % a.frames, row: a.row };
}
