// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadChangesHidden, paintChangesButton, saveChangesHidden } from './changesVisibility';

describe('changesVisibility', () => {
  beforeEach(() => localStorage.clear());

  it('shows the panel until the user turns it off, and remembers the choice', () => {
    expect(loadChangesHidden()).toBe(false);
    saveChangesHidden(true);
    expect(loadChangesHidden()).toBe(true);
    saveChangesHidden(false);
    expect(loadChangesHidden()).toBe(false);
  });

  it('paints the toolbar button as pressed while the panel is on', () => {
    const b = document.createElement('button');
    paintChangesButton(b, false);
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.classList.contains('active')).toBe(true);
    paintChangesButton(b, true);
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.classList.contains('active')).toBe(false);
  });
});
