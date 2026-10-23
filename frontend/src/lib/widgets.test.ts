import { describe, expect, it } from 'vitest';
import { enabledWidgets, groupBySource, orEmpty, type Definition, type Workspace } from './widgets';

const catalog: Definition[] = [
  { id: 'pr-reviews', name: 'PR 리뷰 현황', description: '', source: 'github', settings: [] },
  { id: 'ci-failures', name: 'CI 실패 PR', description: '', source: 'github', settings: [] },
  { id: 'claude-usage', name: 'Claude 한도', description: '', source: 'claude', settings: [] },
];

describe('groupBySource', () => {
  it('groups definitions by source, keeping catalog order', () => {
    const groups = groupBySource(catalog);
    expect(groups.map((g) => g.source)).toEqual(['github', 'claude']);
    expect(groups[0].items.map((d) => d.id)).toEqual(['pr-reviews', 'ci-failures']);
  });

  it('returns an empty list for an empty catalog', () => {
    expect(groupBySource([])).toEqual([]);
  });

  it('does not mutate its input', () => {
    const frozen = Object.freeze(catalog.map((d) => Object.freeze({ ...d })));
    expect(() => groupBySource(frozen)).not.toThrow();
  });
});

describe('orEmpty', () => {
  it('maps null and undefined to an empty list', () => {
    expect(orEmpty(null)).toEqual([]);
    expect(orEmpty(undefined)).toEqual([]);
  });

  it('returns a copy', () => {
    const list = [1, 2];
    const copy = orEmpty(list);
    expect(copy).toEqual(list);
    expect(copy).not.toBe(list);
  });
});

describe('enabledWidgets', () => {
  const ws: Workspace = {
    id: 'w',
    name: 'W',
    folders: [],
    widgets: [
      { type: 'pr-reviews', enabled: true },
      { type: 'ci-failures', enabled: false },
      { type: 'removed-widget', enabled: true },
      { type: 'claude-usage', enabled: true },
    ],
  };

  it('returns enabled widgets that exist in the catalog, in workspace order', () => {
    expect(enabledWidgets(ws, catalog).map((d) => d.id)).toEqual(['pr-reviews', 'claude-usage']);
  });

  it('treats a null widget list from Go as empty', () => {
    const fromGo = { ...ws, widgets: null } as unknown as Workspace;
    expect(enabledWidgets(fromGo, catalog)).toEqual([]);
  });

  it('does not mutate the workspace', () => {
    const before = JSON.stringify(ws);
    enabledWidgets(ws, catalog);
    expect(JSON.stringify(ws)).toBe(before);
  });
});
