/** Where tab order is remembered between runs (keys are Claude session IDs). */
export interface TabOrderStore {
  load(): string[];
  save(keys: string[]): void;
}

/** Remembered keys; older ones (tabs closed long ago) fall off the end. */
export const MAX_TAB_ORDER = 100;

const STORAGE_KEY = 'work-dashboard.tabOrder';

/** Per-viewer storage; a broken or blocked store just forgets the order. */
export const localTabOrder: TabOrderStore = {
  load() {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_TAB_ORDER) : [];
    } catch {
      return [];
    }
  },
  save(keys) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keys.slice(0, MAX_TAB_ORDER)));
    } catch {
      // Not fatal: the order just isn't remembered.
    }
  },
};

/**
 * The new remembered order: open tabs take the saved slots of open tabs in
 * their strip order, so closed (or not yet restored) tabs keep their place;
 * open tabs not saved before go last.
 */
export function mergeOrder(current: readonly string[], saved: readonly string[]): string[] {
  const open = new Set(current);
  const kept = saved.filter((k) => open.has(k));
  let next = 0;
  const merged = saved.map((k) => (open.has(k) ? current[next++] : k));
  return [...merged, ...current.slice(kept.length)];
}
