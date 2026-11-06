/** The office pets on screen: their sheets, what they say, drawing and clicks (behaviour in pet.ts). */
import type { Box } from './furnitureLayout';
import { drawBubble } from './labels';
import { PET_COLS, PET_ROWS, clickPet, newPet, petAnim, petFrame, stepPet, type Pet, type PetWorld } from './pet';
import { decorIndex } from './room';

/** How tall a pet with big frames is drawn (CSS px); the width follows the frames. */
export const PET_H = 80;
/** Frames up to this tall are drawn as they are: shrinking by a fraction blurs them. */
export const PET_MAX = 112;

/** Drawn size of one frame of fw × fh px (and whether it is shrunk, so smoothed). */
export function petDrawSize(fw: number, fh: number): { w: number; h: number; scaled: boolean } {
  if (fw <= 0 || fh <= 0) return { w: PET_H, h: PET_H, scaled: false };
  if (fh <= PET_MAX) return { w: fw, h: fh, scaled: false };
  return { w: Math.round((fw * PET_H) / fh), h: PET_H, scaled: true };
}
const BUBBLE_MAX = 22;

export interface PetArt {
  sheet: string; // data URL of a Petdex-style sheet
  lines: string[];
}

interface Member {
  img: HTMLImageElement;
  lines: readonly string[];
  pet: Pet | null; // placed once the room is known
}

/** A character as the pets see it. */
export interface Neighbour {
  id: string;
  x: number;
  y: number;
  streak: boolean; // on a work streak
  waitLong: boolean; // waiting on you too long
  working: boolean;
}

/** What the pets can see: the floor under the desks, the sofa, the standees and the characters. */
export function petWorld(room: { w: number; h: number }, openTop: number, boxes: readonly Box[], chars: readonly Neighbour[]): PetWorld {
  const bottom = Math.max(0, room.h - 22);
  const sofa = boxes.find((b) => b.id === 'sofa');
  return {
    floor: { left: 30, right: Math.max(30, room.w - 30), top: Math.min(bottom, openTop + PET_H), bottom },
    sofa: sofa ? { x: sofa.x + sofa.w / 2, y: sofa.y + sofa.h - 4 } : null,
    standees: boxes.filter((b) => decorIndex(b.id) >= 0).map((b) => ({ x: b.x + b.w / 2, y: b.y + b.h + 16 })),
    streakers: chars.filter((c) => c.streak).map(({ id, x, y }) => ({ id, x, y })),
    waiting: chars.filter((c) => c.waitLong).map(({ id, x, y }) => ({ id, x, y })),
    allIdle: !chars.some((c) => c.working),
  };
}

export class PetCrew {
  private members: Member[] = [];

  set(art: readonly PetArt[]): void {
    this.members = art.map((a) => {
      const img = new Image();
      img.src = a.sheet;
      return { img, lines: a.lines, pet: null };
    });
  }

  /** The first pet on screen leads; the others may follow it, each in its own slot. */
  update(w: PetWorld, now: number): void {
    const shown = (m: Member) => m.img.complete && m.img.naturalWidth > 0;
    const head = this.members.find(shown) ?? null;
    let slot = 0;
    for (const m of this.members) {
      const start = m.pet ?? newPet({ x: w.floor.left + Math.random() * (w.floor.right - w.floor.left), y: w.floor.bottom }, now);
      // The leader moves first, so its followers see where it is this frame.
      const lead = head && m !== head && shown(m) ? head.pet : null;
      const leader = lead ? { x: lead.x, y: lead.y, lounging: lead.act === 'lounge', slot: ++slot } : null;
      m.pet = stepPet(start, { ...w, leader }, now);
    }
  }

  private size(m: Member): { w: number; h: number; scaled: boolean } {
    return petDrawSize(m.img.naturalWidth / PET_COLS, m.img.naturalHeight / PET_ROWS);
  }

  /** The front-most pet under (x, y), or -1. */
  hit(x: number, y: number): number {
    let best = -1;
    this.members.forEach((m, i) => {
      const p = m.pet;
      if (!p || !m.img.naturalWidth) return; // not drawn while its sheet loads
      const { w, h } = this.size(m);
      // The figure fills the middle of its frame.
      const inside = Math.abs(x - p.x) < w / 3 && y > p.y - h * 0.9 && y < p.y + 4;
      if (inside && (best < 0 || p.y > (this.members[best].pet?.y ?? 0))) best = i;
    });
    return best;
  }

  /** Where a pet's feet are (it is drawn in front of anything higher up). */
  footY(i: number): number {
    return this.members[i]?.pet?.y ?? -Infinity;
  }

  click(i: number, now: number): void {
    const m = this.members[i];
    if (m?.pet) m.pet = clickPet(m.pet, m.lines, now);
  }

  /** One entry per pet, to be drawn among the characters by height. */
  actors(ctx: CanvasRenderingContext2D, tick: number): Array<{ y: number; draw: () => void }> {
    return this.members.flatMap((m) => (m.pet ? [{ y: m.pet.y, draw: () => this.draw(ctx, m, tick) }] : []));
  }

  private draw(ctx: CanvasRenderingContext2D, m: Member, tick: number) {
    const p = m.pet;
    if (!p || !m.img.complete || !m.img.naturalWidth) return;
    const { w, h, scaled } = this.size(m);
    const fw = m.img.naturalWidth / PET_COLS;
    const fh = m.img.naturalHeight / PET_ROWS;
    const { col, row } = petFrame(petAnim(p), tick);
    const x = Math.round(p.x - w / 2);
    const y = Math.round(p.y - h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(Math.round(p.x - w / 6), Math.round(p.y) - 2, Math.round(w / 3), 3);
    // Drawn as is when small enough (crisp); big frames are shrunk, so smoothed.
    ctx.imageSmoothingEnabled = scaled;
    ctx.drawImage(m.img, col * fw, row * fh, fw, fh, x, y, w, h);
    ctx.imageSmoothingEnabled = false;
    if (p.line) drawBubble(ctx, p.line, p.x, y + 6, false, BUBBLE_MAX);
  }
}
