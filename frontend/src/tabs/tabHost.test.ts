// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TabHost, type TabOptions } from './tabHost';

let strip: HTMLElement;
let body: HTMLElement;
let changes: Array<string | null>;
let host: TabHost;

function tab(id: string, extra: Partial<TabOptions> = {}): TabOptions {
  return { id, title: id, kind: 'file', pane: document.createElement('div'), onClose: () => host.remove(id), ...extra };
}

const activePane = () => body.querySelector('.tab-pane.active');

beforeEach(() => {
  strip = document.createElement('div');
  body = document.createElement('div');
  changes = [];
  host = new TabHost(strip, body, (id) => changes.push(id));
});

describe('TabHost', () => {
  it('activates new tabs by default and reports changes', () => {
    const a = tab('a');
    host.add(a);
    host.add(tab('b'));
    expect(host.activeId).toBe('b');
    expect(activePane()).not.toBe(a.pane);
    expect(strip.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
    expect(changes.at(-1)).toBe('b');
  });

  it('keeps the current tab when adding in the background', () => {
    host.add(tab('a'));
    const b = tab('b');
    host.add(b, { activate: false });
    expect(host.activeId).toBe('a');
    expect(b.pane.classList.contains('active')).toBe(false);
  });

  it('activates a background tab when nothing else is open', () => {
    host.add(tab('a'), { activate: false });
    expect(host.activeId).toBe('a');
  });

  it('ignores a duplicate id instead of orphaning DOM', () => {
    host.add(tab('a'));
    host.add(tab('a'));
    expect(strip.children).toHaveLength(1);
    expect(body.children).toHaveLength(1);
  });

  it('returns to the most recently used tab when the active one closes', () => {
    host.add(tab('a'));
    host.add(tab('b'));
    host.add(tab('c'));
    host.activate('a');
    host.remove('a');
    expect(host.activeId).toBe('c');
    host.remove('c');
    host.remove('b');
    expect(host.activeId).toBeNull();
    expect(changes.at(-1)).toBeNull();
  });

  it('calls onActivate and the close button handler', () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    host.add(tab('a', { onActivate, onClose }));
    expect(onActivate).toHaveBeenCalledTimes(1);
    strip.querySelector<HTMLButtonElement>('.term-tab-close')!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('TabHost groups', () => {
  it('shows only the current workspace tabs and returns to its last tab', () => {
    host.setGroup('gw');
    host.add(tab('gw-1', { group: 'gw' }));
    host.add(tab('gw-2', { group: 'gw' }));
    host.activate('gw-1');
    host.setGroup('ship');
    expect(host.activeId).toBeNull();
    expect(changes.at(-1)).toBeNull();
    host.add(tab('ship-1', { group: 'ship' }));
    expect(host.activeId).toBe('ship-1');
    const shown = [...strip.children].filter((e) => !e.classList.contains('hidden'));
    expect(shown).toHaveLength(1);
    host.setGroup('gw');
    expect(host.activeId).toBe('gw-1');
  });

  it('hides workspace tabs when no workspace is selected', () => {
    host.setGroup('gw');
    host.add(tab('gw-1', { group: 'gw' }));
    host.add(tab('free'));
    host.setGroup(null);
    const shown = [...strip.children].filter((e) => !e.classList.contains('hidden'));
    expect(shown).toHaveLength(1);
    expect(host.activeId).toBe('free');
  });

  it('keeps tabs opened for another workspace in the background', () => {
    host.setGroup('gw');
    host.add(tab('gw-1', { group: 'gw' }));
    host.add(tab('other', { group: 'ship' }));
    expect(host.activeId).toBe('gw-1');
    host.activate('other'); // not visible: ignored
    expect(host.activeId).toBe('gw-1');
  });
});

describe('TabHost rename', () => {
  it('renames inline on Enter when the callback accepts', async () => {
    const onRename = vi.fn(async () => true);
    host.add(tab('a', { kind: 'claude', onRename }));
    host.startRename('a');
    const input = strip.querySelector('input')!;
    input.value = '휴가 기능';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(onRename).toHaveBeenCalledWith('휴가 기능');
    expect(strip.querySelector('.term-tab-label')!.textContent).toBe('휴가 기능');
  });

  it('keeps the old name on Escape or when the callback refuses', async () => {
    host.add(tab('a', { kind: 'claude', onRename: async () => false }));
    host.startRename('a');
    const input = strip.querySelector('input')!;
    input.value = 'x';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(strip.querySelector('.term-tab-label')!.textContent).toBe('a');
  });
});
