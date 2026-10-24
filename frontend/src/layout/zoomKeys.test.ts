// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { guardZoomKeys, zoomDirection } from './zoomKeys';

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

describe('zoomDirection', () => {
  it('reads Ctrl with + = - 0 (main row and keypad)', () => {
    expect(zoomDirection(key({ key: '+', ctrlKey: true }))).toBe(1);
    expect(zoomDirection(key({ key: '=', ctrlKey: true }))).toBe(1);
    expect(zoomDirection(key({ key: '-', ctrlKey: true }))).toBe(-1);
    expect(zoomDirection(key({ key: '0', ctrlKey: true }))).toBe(0);
    expect(zoomDirection(key({ key: 'x', code: 'NumpadAdd', ctrlKey: true }))).toBe(1);
    expect(zoomDirection(key({ key: '-' }))).toBeUndefined();
    expect(zoomDirection(key({ key: 'c', ctrlKey: true }))).toBeUndefined();
    expect(zoomDirection(key({ key: '-', ctrlKey: true, altKey: true }))).toBeUndefined();
  });
});

describe('guardZoomKeys', () => {
  it('zooms before the terminal sees the key, other keys pass', () => {
    const onZoom = vi.fn();
    const off = guardZoomKeys(window, onZoom);
    const input = document.createElement('textarea');
    document.body.append(input);
    const inner = vi.fn();
    input.addEventListener('keydown', inner);
    const zoom = key({ key: '-', ctrlKey: true });
    input.dispatchEvent(zoom);
    expect(onZoom).toHaveBeenCalledWith(-1);
    expect(inner).not.toHaveBeenCalled();
    expect(zoom.defaultPrevented).toBe(true);
    input.dispatchEvent(key({ key: 'c', ctrlKey: true }));
    expect(inner).toHaveBeenCalledTimes(1);
    off();
    input.dispatchEvent(key({ key: '-', ctrlKey: true }));
    expect(onZoom).toHaveBeenCalledTimes(1);
  });
});
