// Mirrors internal/widget and internal/workspace JSON shapes.

export type Source = 'github' | 'claude' | 'local';

export interface SettingSpec {
  key: string;
  label: string;
  kind: 'bool' | 'int' | 'string' | 'stringList' | 'enum';
  default: unknown;
  options?: string[];
  min: number;
  max: number;
  description?: string;
}

export interface Definition {
  id: string;
  name: string;
  description: string;
  source: Source;
  settings: SettingSpec[];
}

export interface Instance {
  type: string;
  enabled: boolean;
  settings?: Record<string, unknown>;
}

export interface Workspace {
  id: string;
  name: string;
  folders: string[];
  widgets: Instance[];
  notes?: string;
}

export interface ListResult {
  workspaces: Workspace[] | null;
  problems: string[] | null;
}

export interface SourceGroup {
  source: Source;
  items: Definition[];
}

export function groupBySource(catalog: readonly Definition[]): SourceGroup[] {
  return catalog.reduce<SourceGroup[]>((groups, def) => {
    const existing = groups.find((g) => g.source === def.source);
    if (!existing) return [...groups, { source: def.source, items: [def] }];
    return groups.map((g) => (g === existing ? { ...g, items: [...g.items, def] } : g));
  }, []);
}

/** Go encodes nil slices as null; turn that into an empty list. */
export function orEmpty<T>(list: readonly T[] | null | undefined): T[] {
  return list ? [...list] : [];
}

/** Enabled widgets of a workspace that still exist in the catalog, in workspace order. */
export function enabledWidgets(ws: Workspace, catalog: readonly Definition[]): Definition[] {
  return orEmpty(ws.widgets)
    .filter((w) => w.enabled)
    .map((w) => catalog.find((d) => d.id === w.type))
    .filter((d): d is Definition => d !== undefined);
}
