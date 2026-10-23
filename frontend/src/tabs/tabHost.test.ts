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
