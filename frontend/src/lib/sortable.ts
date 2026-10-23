/** Drag-and-drop reordering shared by widget cards, workspaces and folders. */

export type Where = 'before' | 'after';

/**
 * Moves the item with key `from` before/after the item with key `to`.
 * Returns the same array when nothing changes (unknown or identical keys).
 */
export function moveBy<T>(list: readonly T[], key: (item: T) => string, from: string, to: string, where: Where): T[] {
  if (from === to) return list as T[];
  const i = list.findIndex((x) => key(x) === from);
  if (i < 0 || !list.some((x) => key(x) === to)) return list as T[];
  const rest = list.filter((_, j) => j !== i);
  const target = rest.findIndex((x) => key(x) === to);
  const at = where === 'before' ? target : target + 1;
  return [...rest.slice(0, at), list[i], ...rest.slice(at)];
}

/** Orders items by a saved list of keys; unknown items keep their order at the end. */
export function applyOrder<T>(list: readonly T[], key: (item: T) => string, order: readonly string[]): T[] {
  const rank = new Map(order.map((k, i) => [k, i]));
  return list
    .map((item, i) => ({ item, i, r: rank.get(key(item)) ?? order.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.item);
}

/**
 * Makes children of `container` matching `selector` sortable by dragging.
 * Each item needs data-sort-key; an optional `handle` selector limits where
 * dragging starts. Calls onMove(from, to, where) on drop.
 */
export function makeSortable(
  container: HTMLElement,
  selector: string,
  onMove: (from: string, to: string, where: Where) => void,
  handle?: string,
): void {
  let dragging: string | null = null;
  const items = () => [...container.querySelectorAll<HTMLElement>(selector)];
  const clearMarks = () => items().forEach((el) => el.classList.remove('drop-before', 'drop-after', 'dragging'));

  for (const el of items()) {
    const grip = handle ? el.querySelector<HTMLElement>(handle) : el;
    if (!grip) continue;
    // Only arm dragging from the grip, so text and buttons stay clickable.
    grip.addEventListener('pointerdown', () => {
      el.draggable = true;
      // A click without a drag fires no dragend: disarm on release so text in
      // the item stays selectable.
      const off = () => {
        if (!dragging) el.draggable = false;
      };
      window.addEventListener('pointerup', off, { once: true });
      window.addEventListener('pointercancel', off, { once: true });
    });
    el.addEventListener('dragstart', (e) => {
      dragging = el.dataset.sortKey ?? null;
      el.classList.add('dragging');
      // A private type, so dropping into a text field or terminal inserts nothing.
      e.dataTransfer?.setData('application/x-work-dashboard-sort', dragging ?? '');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.draggable = false;
      dragging = null;
      clearMarks();
    });
    el.addEventListener('dragover', (e) => {
      if (!dragging || el.dataset.sortKey === dragging) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const where: Where = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
      el.classList.toggle('drop-before', where === 'before');
      el.classList.toggle('drop-after', where === 'after');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = dragging;
      const to = el.dataset.sortKey;
      const where: Where = el.classList.contains('drop-before') ? 'before' : 'after';
      clearMarks();
      if (from && to && from !== to) onMove(from, to, where);
    });
  }
}
