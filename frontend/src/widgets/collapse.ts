/** Which widget cards are collapsed; a per-viewer convenience kept in localStorage. */

export type Collapsed = Record<string, true>;

const STORAGE_KEY = 'work-dashboard.collapsed';

export const collapseKey = (workspaceId: string, type: string) => `${workspaceId}/${type}`;

export function toggleCollapsed(state: Collapsed, key: string): Collapsed {
  if (state[key]) {
    const { [key]: _removed, ...rest } = state;
    return rest;
  }
  return { ...state, [key]: true };
}

export function parseCollapsed(raw: string | null): Collapsed {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, on]) => on === true)) as Collapsed;
  } catch {
    return {};
  }
}

export function loadCollapsed(): Collapsed {
  try {
    return parseCollapsed(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

export function saveCollapsed(state: Collapsed): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the state just isn't remembered.
  }
}
