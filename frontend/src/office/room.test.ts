import { describe, expect, it } from 'vitest';
import { WALL_H } from './agentState';
import { ITEM_SIZE, itemAt, layoutItems, type LayoutInput } from './furnitureLayout';
import { DEFAULT_PREFS, THEMES, boxToSpot, parsePrefs, spotToBox, themeOf, withSpot, withTheme, withoutSpots } from './room';

describe('room preferences', () => {
  it('falls back to the default for missing or broken storage', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('42')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('null')).toEqual(DEFAULT_PREFS);
  });

  it('keeps known themes and items only, with spots inside the room', () => {
    const raw = JSON.stringify({
      theme: 'carpet',
      spots: { rug: { fx: 0.3, fy: 0.8 }, sofa: { fx: 2, fy: -1 }, desk: { fx: 0.1, fy: 0.1 }, aquarium: { fx: 'x', fy: 1 }, bookshelf: { fx: NaN, fy: 0 } },
    });
    expect(parsePrefs(raw)).toEqual({ theme: 'carpet', spots: { rug: { fx: 0.3, fy: 0.8 }, sofa: { fx: 1, fy: 0 } } });
    expect(parsePrefs(JSON.stringify({ theme: 'neon', spots: [] })).theme).toBe('wood');
  });

  it('updates without changing the original', () => {
    const p = withTheme(DEFAULT_PREFS, 'forest');
    const q = withSpot(p, 'rug', { fx: 1.5, fy: 0.5 });
    expect(DEFAULT_PREFS).toEqual({ theme: 'wood', spots: {} });
    expect(p.spots).toEqual({});
    expect(q).toEqual({ theme: 'forest', spots: { rug: { fx: 1, fy: 0.5 } } });
    expect(withoutSpots(q)).toEqual({ theme: 'forest', spots: {} });
  });

  it('has a distinct theme for each id, and a fallback', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(themeOf('oak').id).toBe('oak');
    expect(themeOf('nope' as never).id).toBe('wood');
  });

  it('turns a dragged box into a spot and back, inside the room', () => {
    const room = { w: 800, h: 300 };
    const item = { w: 60, h: 40 };
    const spot = boxToSpot(100, 200, room, item);
    expect(spotToBox(spot, room, item)).toEqual({ x: 100, y: 200 });
    // The same spot follows a resized room.
    expect(spotToBox(spot, { w: 400, h: 150 }, item)).toEqual({ x: 35, y: 80 });
    // Dragged past the edges: kept inside.
    expect(spotToBox(boxToSpot(-50, 999, room, item), room, item)).toEqual({ x: 0, y: 260 });
    expect(spotToBox(boxToSpot(790, -30, room, item), room, item)).toEqual({ x: 740, y: 0 });
    expect(boxToSpot(0, 0, { w: 0, h: 0 }, item)).toEqual({ fx: 0.5, fy: 1 });
  });
});

describe('furniture layout', () => {
  const base: LayoutInput = {
    room: { w: 900, h: 500 },
    wallH: WALL_H,
    deskBottom: 200,
    hasDesks: true,
    level: 0,
    spots: {},
    editing: false,
  };
  const ids = (i: LayoutInput) => layoutItems(i).map((b) => b.id);

  it('shows furniture once the week earned it, the rug drawn first', () => {
    expect(ids(base)).toEqual(['rug', 'plantLeft', 'plantRight']);
    expect(ids({ ...base, level: 3 }).sort()).toEqual(['aquarium', 'bookshelf', 'plantLeft', 'plantRight', 'rug', 'sofa']);
    expect(ids({ ...base, level: 3 })[0]).toBe('rug');
  });

  it('keeps the default places of the old office', () => {
    const boxes = layoutItems({ ...base, level: 3 });
    const at = (id: string) => boxes.find((b) => b.id === id);
    expect(at('plantLeft')).toMatchObject({ x: 12, y: WALL_H - 58 });
    expect(at('plantRight')).toMatchObject({ x: 900 - 32 - 12 });
    expect(at('bookshelf')).toMatchObject({ x: 12, y: 500 - 6 - 64 });
    expect(at('sofa')).toMatchObject({ x: 80, y: 500 - 6 - 42 });
    expect(at('aquarium')).toMatchObject({ x: 168, y: 500 - 6 - 46 });
    expect(at('rug')).toMatchObject({ x: 450 - 48, y: 200 + (300 - 96) / 2 });
  });

  it('hides defaults the room has no space for, except while decorating', () => {
    const cramped = { ...base, room: { w: 340, h: 260 }, level: 3 };
    expect(ids(cramped).sort()).toEqual(['plantLeft', 'plantRight']);
    expect(ids({ ...base, hasDesks: false })).not.toContain('rug');
    const editing = layoutItems({ ...cramped, editing: true });
    expect(editing).toHaveLength(6);
    for (const b of editing) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(340);
      expect(b.y + b.h).toBeLessThanOrEqual(260);
    }
  });

  it('puts moved pieces where the user left them, even in a cramped room', () => {
    const boxes = layoutItems({ ...base, room: { w: 340, h: 260 }, hasDesks: false, spots: { rug: { fx: 0.5, fy: 1 } } });
    expect(boxes.find((b) => b.id === 'rug')).toEqual({ id: 'rug', x: 170 - 48, y: 260 - 96, ...ITEM_SIZE.rug });
    // Not earned yet: a saved spot does not bring it.
    expect(ids({ ...base, spots: { aquarium: { fx: 0.5, fy: 0.5 } } })).not.toContain('aquarium');
  });

  it('picks the front-most piece under the pointer', () => {
    const boxes = layoutItems({ ...base, spots: { plantLeft: { fx: 0.5, fy: 0.6 } } });
    const rug = boxes.find((b) => b.id === 'rug')!;
    const plant = boxes.find((b) => b.id === 'plantLeft')!;
    expect(itemAt(boxes, plant.x + 5, plant.y + plant.h - 5)?.id).toBe('plantLeft');
    expect(itemAt(boxes, rug.x + 2, rug.y + rug.h - 2)?.id).toBe('rug');
    expect(itemAt(boxes, 2, 499)).toBeNull();
  });
});
