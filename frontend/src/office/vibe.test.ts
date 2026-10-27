import { describe, expect, it } from 'vitest';
import {
  coffeeEmpty,
  coffeeLevel,
  confetti,
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
} from './vibe';

describe('usage limits', () => {
  it('darkens from half the 5-hour limit and lights desk lamps from 90%', () => {
    expect(lightingFor(null)).toEqual({ dark: 0, lamps: false });
    expect(lightingFor(49)).toEqual({ dark: 0, lamps: false });
    expect(lightingFor(70).dark).toBeCloseTo(0.2);
    expect(lightingFor(70).lamps).toBe(false);
    expect(lightingFor(95)).toEqual({ dark: 0.55, lamps: true });
  });

  it('drains the coffee pot', () => {
    expect(coffeeLevel(null)).toBe(1);
    expect(coffeeLevel(25)).toBe(0.75);
    expect(coffeeLevel(130)).toBe(0);
    expect(coffeeEmpty(97)).toBe(false);
    expect(coffeeEmpty(99)).toBe(true);
  });

  it('wilts the plants with the 7-day limit', () => {
    expect(plantHealth(null)).toBe('fresh');
    expect(plantHealth(59)).toBe('fresh');
    expect(plantHealth(60)).toBe('droopy');
    expect(plantHealth(85)).toBe('wilted');
  });

  it('sees a reset in a big drop only', () => {
    expect(isReset(80, 2)).toBe(true);
    expect(isReset(80, 70)).toBe(false);
    expect(isReset(20, 0)).toBe(false); // nothing to recover from
    expect(isReset(null, 0)).toBe(false);
  });
});

describe('session tokens', () => {
  it('stacks paper and cups', () => {
    expect(paperCount(9_999)).toBe(0);
    expect(paperCount(35_000)).toBe(3);
    expect(paperCount(5_000_000)).toBe(8);
    expect(cupCount(99_999)).toBe(0);
    expect(cupCount(100_000)).toBe(1);
    expect(cupCount(300_000)).toBe(2);
    expect(cupCount(9_000_000)).toBe(3);
    expect(sweating(100_000)).toBe(true);
  });

  it('celebrates the highest milestone crossed', () => {
    expect(crossedMilestone(90_000, 120_000)).toBe(100_000);
    expect(crossedMilestone(120_000, 130_000)).toBeNull();
    expect(crossedMilestone(0, 2_000_000)).toBe(1_000_000);
  });

  it('formats token counts', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(12_340)).toBe('12.3K');
    expect(formatTokens(100_000)).toBe('100K');
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(1_250_000)).toBe('1.3M');
  });

  it('picks the MVP among terminals that used tokens', () => {
    expect(mvp([{ title: 'a', tokens: 0 }])).toBeNull();
    expect(mvp([{ title: 'a', tokens: 5 }, { title: 'b', tokens: 9 }])?.title).toBe('b');
  });
});

describe('office level', () => {
  it('earns furniture over the week', () => {
    expect(officeLevel(0)).toBe(0);
    expect(officeLevel(500_000)).toBe(1);
    expect(officeLevel(3_000_000)).toBe(2);
    expect(officeLevel(50_000_000)).toBe(3);
  });
});

describe('confetti', () => {
  it('bursts upward, then falls', () => {
    const start = confetti(0);
    expect(start.every((p) => p.x === 0 && p.y === 0)).toBe(true);
    const early = confetti(300);
    const late = confetti(3000);
    const avg = (ps: Array<{ y: number }>) => ps.reduce((s, p) => s + p.y, 0) / ps.length;
    expect(avg(early)).toBeLessThan(0);
    expect(avg(late)).toBeGreaterThan(0);
  });
});
