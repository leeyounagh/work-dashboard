import { describe, expect, it } from 'vitest';
import { PET_H, PET_MAX, petDrawSize, petWorld } from './pets';
import { LINE_MS, PET_SPEED, WAVE_MS, clickPet, newPet, petAnim, petFrame, planPet, stepPet, type PetWorld } from './pet';

const world = (over: Partial<PetWorld> = {}): PetWorld => ({
  floor: { left: 20, right: 380, top: 150, bottom: 280 },
  sofa: null,
  standees: [],
  streakers: [],
  waiting: [],
  allIdle: false,
  ...over,
});
const always = (v: number) => () => v;
const pet = newPet({ x: 100, y: 200 }, 0);

describe('planPet', () => {
  it('goes to poke a character left waiting on you, standing beside it', () => {
    const p = planPet(pet, world({ waiting: [{ id: 't2', x: 300, y: 220 }] }), 1000, always(0));
    expect(p).toMatchObject({ act: 'poke', target: 't2', tx: 272, ty: 220 });
    expect(p.until).toBeGreaterThan(1000);
  });

  it('lounges on the sofa when nobody is working, or where it is without one', () => {
    expect(planPet(pet, world({ allIdle: true, sofa: { x: 120, y: 260 } }), 0, always(0))).toMatchObject({ act: 'lounge', tx: 120, ty: 260 });
    expect(planPet(pet, world({ allIdle: true }), 0, always(0))).toMatchObject({ act: 'lounge', tx: 100, ty: 200 });
  });

  it('watches someone on a work streak, or looks at a standee', () => {
    expect(planPet(pet, world({ streakers: [{ id: 't1', x: 60, y: 180 }] }), 0, always(0))).toMatchObject({ act: 'watch', target: 't1', tx: 88 });
    expect(planPet(pet, world({ standees: [{ x: 330, y: 160 }] }), 0, always(0))).toMatchObject({ act: 'look', tx: 330, ty: 160 });
  });

  it('otherwise wanders to a point on the floor', () => {
    const p = planPet(pet, world({ waiting: [{ id: 't2', x: 1, y: 1 }], allIdle: true, streakers: [{ id: 't1', x: 1, y: 1 }] }), 0, always(0.99));
    expect(p.act).toBe('wander');
    expect(p.tx).toBeGreaterThanOrEqual(20);
    expect(p.tx).toBeLessThanOrEqual(380);
    expect(p.ty).toBeGreaterThanOrEqual(150);
    expect(p.ty).toBeLessThanOrEqual(280);
  });

  it('keeps its goal on the floor', () => {
    const p = planPet(pet, world({ standees: [{ x: 500, y: 40 }] }), 0, always(0));
    expect(p).toMatchObject({ tx: 380, ty: 150 });
  });
});

describe('stepPet', () => {
  it('walks toward its goal at a stroll, facing the way it goes', () => {
    const p = stepPet({ ...pet, tx: 0, ty: 200, until: 9999 }, world(), 0, always(0));
    expect(p.x).toBeCloseTo(100 - PET_SPEED);
    expect(p.face).toBe(-1);
    expect(petAnim(p)).toBe('runLeft');
  });

  it('plans again once its time is up', () => {
    const p = stepPet({ ...pet, until: 50 }, world({ allIdle: true }), 100, always(0));
    expect(p.act).toBe('lounge');
  });

  it('gives up on a character that is no longer waiting or on a streak', () => {
    const poking = { ...pet, act: 'poke' as const, target: 't2', until: 9999 };
    expect(stepPet(poking, world({ waiting: [{ id: 't2', x: 100, y: 200 }] }), 0, always(0.99)).act).toBe('poke');
    expect(stepPet(poking, world(), 0, always(0.99)).act).toBe('wander');
    const watching = { ...pet, act: 'watch' as const, target: 't1', until: 9999 };
    expect(stepPet(watching, world(), 0, always(0.99)).act).toBe('wander');
  });

  it('stays on the floor when the room shrinks', () => {
    const p = stepPet({ ...pet, x: 600, y: 400, tx: 700, ty: 420, until: 9999 }, world(), 0);
    expect(p.x).toBeLessThanOrEqual(380);
    expect(p.y).toBeLessThanOrEqual(280);
    expect(p).toMatchObject({ tx: 380, ty: 280 });
  });

  it('stops talking once the line is over', () => {
    const talking = { ...pet, until: 9999, line: '당분이 부족해', lineUntil: 500 };
    expect(stepPet(talking, world(), 400).line).toBe('당분이 부족해');
    expect(stepPet(talking, world(), 600).line).toBeNull();
  });
});

describe('clickPet', () => {
  it('stops to wave and says one of its lines', () => {
    const walking = { ...pet, tx: 300, ty: 250, until: 9999 };
    const p = clickPet(walking, ['a', 'b'], 1000, always(0.6));
    expect(p).toMatchObject({ act: 'wave', tx: 100, ty: 200, line: 'b', until: 1000 + WAVE_MS, lineUntil: 1000 + LINE_MS });
    expect(petAnim(p)).toBe('wave');
    expect(clickPet(walking, [], 0).line).toBeNull();
  });
});

describe('petAnim', () => {
  it('shows what it does once it has arrived', () => {
    const still = { ...pet, until: 9999 };
    expect(petAnim({ ...still, act: 'poke' })).toBe('jump');
    expect(petAnim({ ...still, act: 'lounge' })).toBe('wait');
    expect(petAnim({ ...still, act: 'look' })).toBe('idle');
    expect(petAnim({ ...still, tx: 150 })).toBe('runRight');
  });

  it('cycles through the row of its animation', () => {
    expect(petFrame('wave', 5)).toEqual({ col: 1, row: 3 });
    expect(petFrame('runLeft', 9)).toEqual({ col: 1, row: 2 });
  });
});

describe('petWorld', () => {
  it('sees the floor under the desks, the sofa seat, the standees and the characters', () => {
    const boxes = [
      { id: 'sofa' as const, x: 80, y: 400, w: 78, h: 34 },
      { id: 'decor0' as const, x: 700, y: 398, w: 42, h: 96 },
      { id: 'rug' as const, x: 400, y: 300, w: 96, h: 96 },
    ];
    const chars = [
      { id: 't1', x: 100, y: 300, streak: true, waitLong: false, working: true },
      { id: 't2', x: 300, y: 320, streak: false, waitLong: true, working: false },
    ];
    const w = petWorld({ w: 900, h: 500 }, 230, boxes, chars);
    expect(w.floor).toEqual({ left: 30, right: 870, top: 230 + PET_H, bottom: 478 });
    expect(w.sofa).toEqual({ x: 119, y: 430 });
    expect(w.standees).toEqual([{ x: 721, y: 510 }]);
    expect(w.streakers.map((c) => c.id)).toEqual(['t1']);
    expect(w.waiting.map((c) => c.id)).toEqual(['t2']);
    expect(w.allIdle).toBe(false);
    expect(petWorld({ w: 900, h: 500 }, 230, [], [chars[1]]).allIdle).toBe(true);
  });

  it('keeps the floor top above its bottom in a short room', () => {
    const w = petWorld({ w: 300, h: 200 }, 190, [], []);
    expect(w.floor.top).toBeLessThanOrEqual(w.floor.bottom);
    expect(w.sofa).toBeNull();
  });
});

describe('petDrawSize', () => {
  it('draws small frames as they are, and shrinks big ones to PET_H tall', () => {
    expect(petDrawSize(72, 78)).toEqual({ w: 72, h: 78, scaled: false });
    expect(petDrawSize(PET_MAX, PET_MAX)).toEqual({ w: PET_MAX, h: PET_MAX, scaled: false });
    expect(petDrawSize(192, 208)).toEqual({ w: 74, h: PET_H, scaled: true });
    expect(petDrawSize(0, 0)).toEqual({ w: PET_H, h: PET_H, scaled: false });
  });
});
