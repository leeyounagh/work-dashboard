import { describe, expect, it } from 'vitest';
import { FRAME, directionFor, drawSize, frameRect, frameSize, hash, pickSheet } from './sprites';

describe('frameRect', () => {
  it('maps direction to column and frame to row on a 4×7 sheet of 16px frames', () => {
    expect(frameRect('down', 0)).toEqual({ sx: 0, sy: 0 });
    expect(frameRect('up', 1)).toEqual({ sx: FRAME, sy: FRAME });
    expect(frameRect('left', 3)).toEqual({ sx: 2 * FRAME, sy: 3 * FRAME });
    expect(frameRect('right', 4)).toEqual({ sx: 3 * FRAME, sy: 4 * FRAME });
  });

  it('works on larger frames for your own sheets', () => {
    expect(frameRect('left', 4, 128)).toEqual({ sx: 256, sy: 512 });
  });
});

describe('drawSize', () => {
  it('draws pixel art at 48px and detailed (larger) frames bigger', () => {
    expect(drawSize(16)).toBe(48);
    expect(drawSize(128)).toBe(80);
  });
});

describe('frameSize', () => {
  it('is a quarter of the sheet width (4 columns)', () => {
    expect(frameSize(64)).toBe(16);
    expect(frameSize(512)).toBe(128);
    expect(frameSize(0)).toBe(FRAME); // not loaded yet
  });
});

describe('directionFor', () => {
  it('faces where the character moves, horizontal wins on diagonals', () => {
    expect(directionFor(5, 1)).toBe('right');
    expect(directionFor(-5, 2)).toBe('left');
    expect(directionFor(1, 6)).toBe('down');
    expect(directionFor(0, -3)).toBe('up');
    expect(directionFor(0, 0)).toBe('down');
  });
});

describe('pickSheet', () => {
  const sheets = ['a', 'b', 'c'];
  it('is stable per terminal and uses the dog for shells', () => {
    expect(pickSheet('t1', 'claude', sheets, 'dog')).toBe(pickSheet('t1', 'claude', sheets, 'dog'));
    expect(sheets).toContain(pickSheet('t7', 'claude', sheets, 'dog'));
    expect(pickSheet('t1', 'shell', sheets, 'dog')).toBe('dog');
    expect(hash('a')).not.toBe(hash('b'));
  });
});
