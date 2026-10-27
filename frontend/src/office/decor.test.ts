import { describe, expect, it } from 'vitest';
import { WALL_H, deskSpot } from './agentState';
import { COUNTER_W, FRAME_W, coffeeSpot, wallSlots } from './decor';

describe('wall slots', () => {
  it('drops the MVP frame, then the counter, as the office narrows', () => {
    expect(wallSlots(900)).toEqual({ frameX: 56, counterX: 900 - 60 - COUNTER_W });
    expect(wallSlots(300).frameX).toBeNull();
    expect(wallSlots(300).counterX).not.toBeNull();
    expect(wallSlots(200)).toEqual({ frameX: null, counterX: null });
    expect(coffeeSpot(200, WALL_H)).toBeNull();
  });

  it('never overlaps the frame and the counter', () => {
    for (const w of [240, 320, 400, 900]) {
      const { frameX, counterX } = wallSlots(w);
      if (frameX !== null && counterX !== null) expect(frameX + FRAME_W).toBeLessThan(counterX);
    }
  });

  it('queues for coffee above the first row of desks', () => {
    const spot = coffeeSpot(900, WALL_H);
    expect(spot).not.toBeNull();
    // A desk tile starts 18px below its row top.
    expect(spot!.y).toBeLessThan(deskSpot(0, 900).y + 18);
  });
});
