// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { applyOrder, makeSortable, moveBy } from './sortable';

const id = (s: string) => s;

describe('moveBy', () => {
  const list = ['a', 'b', 'c', 'd'];
  it('moves before/after a target', () => {
    expect(moveBy(list, id, 'd', 'a', 'before')).toEqual(['d', 'a', 'b', 'c']);
    expect(moveBy(list, id, 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });
  it('returns the same list when nothing changes', () => {
    expect(moveBy(list, id, 'a', 'a', 'after')).toBe(list);
    expect(moveBy(list, id, 'x', 'a', 'after')).toBe(list);
  });
});

describe('applyOrder', () => {
  it('sorts by saved keys and appends unknown ones in their order', () => {
    expect(applyOrder(['a', 'b', 'c', 'new'], id, ['c', 'a', 'gone'])).toEqual(['c', 'a', 'b', 'new']);
    expect(applyOrder(['a', 'b'], id, [])).toEqual(['a', 'b']);
  });
});

describe('makeSortable', () => {
  it('reports a drop with the position relative to the target', () => {
    const list = document.createElement('ul');
    for (const k of ['a', 'b']) {
      const li = document.createElement('li');
      li.dataset.sortKey = k;
      list.append(li);
    }
    const onMove = vi.fn();
    makeSortable(list, 'li', onMove);
    const [a, b] = list.querySelectorAll('li');
    a.dispatchEvent(new Event('dragstart'));
    const over = new Event('dragover', { cancelable: true }) as DragEvent;
    Object.defineProperty(over, 'clientY', { value: 1000 }); // below the middle → after
    b.dispatchEvent(over);
    expect(b.classList.contains('drop-after')).toBe(true);
    b.dispatchEvent(new Event('drop', { cancelable: true }));
    expect(onMove).toHaveBeenCalledWith('a', 'b', 'after');
    expect(b.classList.contains('drop-after')).toBe(false);
  });
});
