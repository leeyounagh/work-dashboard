import { describe, expect, it } from 'vitest';
import type { Instance } from '../lib/widgets';
import { applyRecommendation, isAdded, newWidgetId, removeWidget, settingsSummary, updateWidget, upsertWidget, widgetKey } from './manager';

const list: Instance[] = [
  { type: 'pr-reviews', enabled: false, settings: { scope: 'mine' } },
  { type: 'command', id: 'command-aaa111', title: '빌드', enabled: true, settings: {} },
];

describe('widget keys', () => {
  it('uses the id for repeatable widgets and the type otherwise', () => {
    expect(list.map(widgetKey)).toEqual(['pr-reviews', 'command-aaa111']);
  });

  it('updates and removes by key without touching others', () => {
    const next = updateWidget(list, 'command-aaa111', (w) => ({ ...w, title: '테스트' }));
    expect(next[1].title).toBe('테스트');
    expect(list[1].title).toBe('빌드');
    expect(removeWidget(list, 'command-aaa111')).toHaveLength(1);
  });

  it('upserts only single-instance widgets of a type', () => {
    const next = upsertWidget(list, 'command', (w) => ({ ...w, enabled: true }));
    // A repeatable instance with an id is not the "single" command widget.
    expect(next).toHaveLength(3);
  });

  it('makes ids that pass the backend pattern', () => {
    expect(newWidgetId('links', list)).toMatch(/^links-[0-9a-f]{6}$/);
  });

  it('never reuses an id already in the list', () => {
    const taken: Instance[] = [{ type: 'command', id: 'command-aaa111', enabled: true, settings: {} }];
    for (let i = 0; i < 50; i++) expect(newWidgetId('command', taken)).not.toBe('command-aaa111');
  });
});

describe('applyRecommendation', () => {
  it('enables a single widget with the suggested settings', () => {
    const next = applyRecommendation(list, { type: 'pr-reviews', enabled: true, settings: { scope: 'both' } });
    expect(next[0]).toEqual({ type: 'pr-reviews', enabled: true, settings: { scope: 'both' } });
  });

  it('takes on/off from the recommendation', () => {
    const rec: Instance = { type: 'command', id: 'command-bbb222', title: '로그', enabled: false, settings: { command: 'git log' } };
    expect(applyRecommendation(list, rec).at(-1)?.enabled).toBe(false);
    expect(applyRecommendation(list, { type: 'pr-reviews', enabled: false, settings: {} })[0].enabled).toBe(false);
  });

  it('appends a repeatable widget once', () => {
    const rec: Instance = { type: 'links', id: 'links-123abc', title: '문서', enabled: true, settings: {} };
    const once = applyRecommendation(list, rec);
    expect(applyRecommendation(once, rec)).toHaveLength(3);
  });
});

describe('recommendation rows', () => {
  it('summarises suggested settings so a command can be read before adding', () => {
    expect(settingsSummary({ command: 'git log --oneline', limit: 5, empty: '' })).toBe('command: git log --oneline · limit: 5');
    expect(settingsSummary(undefined)).toBe('');
  });

  it('marks a recommendation added from the saved widgets', () => {
    expect(isAdded(list, { type: 'command', id: 'command-aaa111', enabled: true, settings: {} })).toBe(true);
    expect(isAdded(list, { type: 'pr-reviews', enabled: true, settings: {} })).toBe(false);
    expect(isAdded(list, { type: 'links', id: 'links-000000', enabled: true, settings: {} })).toBe(false);
  });
});
