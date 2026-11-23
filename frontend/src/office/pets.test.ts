// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pet, PetWorld } from './pet';
import { PetCrew, drawPetName } from './pets';

const world: PetWorld = { floor: { left: 20, right: 380, top: 150, bottom: 280 }, sofa: null, standees: [], streakers: [], waiting: [], allIdle: true };
type Inner = { members: Array<{ img: HTMLImageElement; pet: Pet | null }> };
const inner = (crew: PetCrew) => (crew as unknown as Inner).members;
const pets = (crew: PetCrew) => inner(crew).map((m) => m.pet!);

/** n pets; `drawn` says which sheets loaded (happy-dom loads no images). */
function crewOf(drawn: boolean[]): PetCrew {
  const crew = new PetCrew();
  crew.set(drawn.map(() => ({ sheet: 'data:image/png;base64,', lines: [] })));
  inner(crew).forEach((m, i) => {
    Object.defineProperty(m.img, 'complete', { value: true });
    Object.defineProperty(m.img, 'naturalWidth', { value: drawn[i] ? 576 : 0 });
  });
  return crew;
}

afterEach(() => vi.restoreAllMocks());

describe('PetCrew', () => {
  it('lets the first pet lead; each follower curls up in its own place by it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const crew = crewOf([true, true, true]);
    crew.update(world, 0);
    const [lead, a, b] = pets(crew);
    expect(lead.act).toBe('lounge');
    expect([a.act, b.act]).toEqual(['lounge', 'lounge']);
    expect(a.tx).not.toBe(b.tx);
    expect(Math.abs(a.tx - lead.x)).toBe(44);
    expect(Math.abs(b.tx - lead.x)).toBe(88);
    // The leader follows nobody: with everyone busy, it wanders.
    crew.update({ ...world, allIdle: false }, 20000);
    expect(pets(crew)[0].act).toBe('wander');
  });

  it('follows the first pet that is on screen, not one whose sheet did not load', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const crew = crewOf([false, true, true]);
    crew.update(world, 0);
    const [hidden, lead, cat] = pets(crew);
    expect(hidden.target).toBeNull();
    expect(lead.target).toBeNull();
    expect(cat.target).toBe('leader');
  });
});

describe('drawPetName', () => {
  function fakeCtx() {
    return { font: '', textAlign: '', textBaseline: '', fillStyle: '', measureText: (t: string) => ({ width: t.length * 6 }), fillRect: vi.fn(), fillText: vi.fn() };
  }

  it('writes the name centred just under the feet', () => {
    const ctx = fakeCtx();
    drawPetName(ctx as unknown as CanvasRenderingContext2D, '나경', 100, 200);
    expect(ctx.fillText).toHaveBeenCalledWith('나경', 100, 213);
    const [x, y, w] = ctx.fillRect.mock.calls[0];
    expect(y).toBeGreaterThan(200); // below the feet, clear of the speech bubble above
    expect(x + w / 2).toBe(100);
  });

  it('draws nothing for a blank name and cuts a long one', () => {
    const ctx = fakeCtx();
    drawPetName(ctx as unknown as CanvasRenderingContext2D, '   ', 0, 0);
    expect(ctx.fillText).not.toHaveBeenCalled();
    drawPetName(ctx as unknown as CanvasRenderingContext2D, '가'.repeat(20), 0, 0);
    expect(ctx.fillText.mock.calls[0][0]).toBe(`${'가'.repeat(11)}…`);
  });
});
