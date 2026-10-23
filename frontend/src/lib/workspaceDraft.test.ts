import { describe, expect, it } from 'vitest';
import { addFolder, base64ToBytes, emptyDraft, isDirty, parseTopics, removeFolder } from './workspaceDraft';
import type { Workspace } from './widgets';

const ws: Workspace = { id: 'gw', name: 'GW', folders: ['C:\\fe'], widgets: [], notes: '' };

describe('addFolder', () => {
  it('appends a new folder without mutating the input', () => {
    const next = addFolder(ws, 'C:\\be');
    expect(next.folders).toEqual(['C:\\fe', 'C:\\be']);
    expect(ws.folders).toEqual(['C:\\fe']);
  });

  it('ignores duplicates case-insensitively and trailing slashes', () => {
    expect(addFolder(ws, 'c:\\FE\\')).toBe(ws);
  });

  it('ignores empty paths (cancelled picker)', () => {
    expect(addFolder(ws, '')).toBe(ws);
  });
});

describe('removeFolder', () => {
  it('removes by index without mutating', () => {
    const two = addFolder(ws, 'C:\\be');
    expect(removeFolder(two, 0).folders).toEqual(['C:\\be']);
    expect(two.folders).toHaveLength(2);
  });
});

describe('emptyDraft', () => {
  it('has no id so the backend assigns one', () => {
    expect(emptyDraft()).toEqual({ id: '', name: '', folders: [], widgets: [], notes: '' });
  });
});

describe('isDirty', () => {
  it('detects name, folder and notes changes', () => {
    expect(isDirty(ws, ws)).toBe(false);
    expect(isDirty(ws, { ...ws, name: 'X' })).toBe(true);
    expect(isDirty(ws, addFolder(ws, 'C:\\be'))).toBe(true);
    expect(isDirty(ws, { ...ws, notes: 'memo' })).toBe(true);
    expect(isDirty(ws, { ...ws, topics: ['next'] })).toBe(true);
    expect(isDirty({ ...ws, topics: [] }, ws)).toBe(false);
  });
});

describe('parseTopics', () => {
  it('splits on commas and spaces, dropping blanks and repeats', () => {
    expect(parseTopics('next, react  next,,앱')).toEqual(['next', 'react', '앱']);
    expect(parseTopics('  ')).toEqual([]);
  });
});

describe('base64ToBytes', () => {
  it('decodes UTF-8 split across chunks byte-exactly', () => {
    // "é" is C3 A9; a chunk may end after C3.
    expect(Array.from(base64ToBytes(btoa('\xc3')))).toEqual([0xc3]);
    expect(Array.from(base64ToBytes(btoa('hi')))).toEqual([0x68, 0x69]);
  });
});
