// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { guardZoomKeys, isZoomKey } from './zoomKeys';

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

describe('isZoomKey', () => {
  it('matches Ctrl with + = - 0 (main row and keypad)', () => {
    for (const k of ['+', '=', '-', '0']) expect(isZoomKey(key({ key: k, ctrlKey: true }))).toBe(true);
    for (const code of ['NumpadAdd', 'NumpadSubtract', 'Numpad0']) expect(isZoomKey(key({ key: 'x', code, ctrlKey: true }))).toBe(true);
    expect(isZoomKey(key({ key: '-' }))).toBe(false);
    expect(isZoomKey(key({ key: 'c', ctrlKey: true }))).toBe(false);
    expect(isZoomKey(key({ key: '-', ctrlKey: true, altKey: true }))).toBe(false);
  });
});

describe('guardZoomKeys', () => {
  it('keeps zoom keys from the terminal but leaves the browser default (zoom) alone', () => {
    const off = guardZoomKeys(window);
    const input = document.createElement('textarea');
    document.body.append(input);
    const inner = vi.fn();
    input.addEventListener('keydown', inner);
    const zoom = key({ key: '-', ctrlKey: true });
    input.dispatchEvent(zoom);
    expect(inner).not.toHaveBeenCalled();
    expect(zoom.defaultPrevented).toBe(false);
    input.dispatchEvent(key({ key: 'c', ctrlKey: true }));
    expect(inner).toHaveBeenCalledTimes(1);
    off();
    input.dispatchEvent(key({ key: '-', ctrlKey: true }));
    expect(inner).toHaveBeenCalledTimes(2);
  });
});
