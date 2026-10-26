// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { blockStrayFileDrops, droppedPathsText } from './fileDrop';

describe('droppedPathsText', () => {
  it('types plain Windows paths as they are, separated and followed by a space', () => {
    expect(droppedPathsText(['C:\\work\\a.png', 'C:\\work\\b.md'], false)).toBe('C:\\work\\a.png C:\\work\\b.md ');
  });

  it('quotes Windows paths with spaces or shell characters', () => {
    expect(droppedPathsText(['C:\\Users\\me\\OneDrive - 회사\\shot 1.png'], false)).toBe('"C:\\Users\\me\\OneDrive - 회사\\shot 1.png" ');
    expect(droppedPathsText(['C:\\a&b\\c.txt'], false)).toBe('"C:\\a&b\\c.txt" ');
  });

  it('escapes spaces and shell characters with a backslash on macOS and Linux', () => {
    expect(droppedPathsText(['/Users/me/My Shots/a (1).png'], true)).toBe('/Users/me/My\\ Shots/a\\ \\(1\\).png ');
  });

  it('skips empty paths and gives nothing for no paths', () => {
    expect(droppedPathsText(['', 'C:\\a.txt'], false)).toBe('C:\\a.txt ');
    expect(droppedPathsText([], false)).toBe('');
  });
});

describe('blockStrayFileDrops', () => {
  const fileDrag = (type: string, prevented = false) => {
    const e = new Event(type, { cancelable: true }) as DragEvent;
    Object.defineProperty(e, 'dataTransfer', { value: { types: ['Files'], dropEffect: 'copy' } });
    if (prevented) e.preventDefault();
    return e;
  };

  it('stops a file dropped outside a terminal from opening in the window', () => {
    const off = blockStrayFileDrops(window);
    const over = fileDrag('dragover');
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer!.dropEffect).toBe('none');
    const drop = fileDrag('drop');
    window.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    off();
  });

  it('leaves a drag that a terminal already accepted alone', () => {
    const off = blockStrayFileDrops(window);
    const over = fileDrag('dragover', true);
    window.dispatchEvent(over);
    expect(over.dataTransfer!.dropEffect).toBe('copy');
    off();
  });

  it('ignores drags that carry no files (reordering widgets)', () => {
    const off = blockStrayFileDrops(window);
    const e = new Event('dragover', { cancelable: true }) as DragEvent;
    Object.defineProperty(e, 'dataTransfer', { value: { types: ['application/x-work-dashboard-sort'] } });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    off();
  });
});
