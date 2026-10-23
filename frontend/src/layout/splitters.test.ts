import { describe, expect, it } from 'vitest';
import { DEFAULT_SIZES, clampSizes, parseSizes, resize } from './splitters';

const viewport = { width: 1600, height: 1000 };

describe('clampSizes', () => {
  it('keeps the center usable and panels within bounds', () => {
    const s = clampSizes({ side: 50, widgets: 5000, floor: 5 }, viewport);
    expect(s.side).toBe(180);
    expect(s.floor).toBe(80);
    // Side + widgets leave at least 400px for the center column.
    expect(s.side + s.widgets).toBeLessThanOrEqual(viewport.width - 400);
  });

  it('leaves the terminal at least 160px', () => {
    expect(clampSizes({ ...DEFAULT_SIZES, floor: 990 }, viewport).floor).toBe(1000 - 160 - 16);
  });
});

describe('resize', () => {
  it('moves the matching edge by the drag distance', () => {
    const start = { side: 240, widgets: 320, floor: 260 };
    expect(resize(start, 'side', 30, viewport).side).toBe(270);
    // The widgets column grows when dragged to the left.
    expect(resize(start, 'widgets', -40, viewport).widgets).toBe(360);
    expect(resize(start, 'floor', -60, viewport).floor).toBe(200);
  });
});

describe('parseSizes', () => {
  it('reads saved sizes and ignores junk', () => {
    expect(parseSizes('{"side":300,"widgets":400,"floor":200}')).toEqual({ side: 300, widgets: 400, floor: 200 });
    expect(parseSizes('{"side":"wide"}')).toEqual(DEFAULT_SIZES);
    expect(parseSizes('not json')).toEqual(DEFAULT_SIZES);
    expect(parseSizes(null)).toEqual(DEFAULT_SIZES);
  });
});
