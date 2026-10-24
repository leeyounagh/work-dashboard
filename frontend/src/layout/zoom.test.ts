// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { ZOOM_STEPS, currentZoom, loadZoom, setZoom, stepZoom } from './zoom';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.zoom = '';
});

describe('stepZoom', () => {
  it('moves between fixed steps and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.1, 0)).toBe(1);
    expect(stepZoom(ZOOM_STEPS.at(-1)!, 1)).toBe(ZOOM_STEPS.at(-1));
    expect(stepZoom(ZOOM_STEPS[0], -1)).toBe(ZOOM_STEPS[0]);
    expect(stepZoom(1.05, 1)).toBe(1.1); // between steps: the next one up
  });
});

describe('setZoom', () => {
  it('zooms the page, remembers the level and tells listeners', () => {
    const seen: number[] = [];
    setZoom(1.25, (z) => seen.push(z));
    expect(currentZoom()).toBe(1.25);
    expect(document.documentElement.style.getPropertyValue('--ui-zoom')).toBe('1.25');
    expect(loadZoom()).toBe(1.25);
    expect(seen).toEqual([1.25]);
  });

  it('ignores a stored level that is not a step', () => {
    localStorage.setItem('wd.zoom', '7');
    expect(loadZoom()).toBe(1);
  });
});
