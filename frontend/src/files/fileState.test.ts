import { describe, expect, it } from 'vitest';
import { addOpened, addSeen, baseName, emptyFileState, languageFor, relativeTo, type FileState } from './fileState';

describe('languageFor', () => {
  it.each([
    ['C:\\w\\a.ts', 'typescript'],
    ['a.tsx', 'tsx'],
    ['a.js', 'javascript'],
    ['a.vue', 'html'],
    ['go.mod', 'text'],
    ['main.go', 'go'],
    ['x.JSON', 'json'],
    ['README.md', 'markdown'],
    ['a.yml', 'yaml'],
    ['q.sql', 'sql'],
    ['A.java', 'java'],
    ['s.scss', 'css'],
    ['run.sh', 'shell'],
    ['x.diff', 'diff'],
    ['Makefile', 'text'],
  ])('%s → %s', (path, lang) => {
    expect(languageFor(path)).toBe(lang);
  });
});

describe('baseName / relativeTo', () => {
  it('handles both separators', () => {
    expect(baseName('C:\\w\\src\\a.go')).toBe('a.go');
    expect(baseName('/w/src/a.go')).toBe('a.go');
  });

  it('shows a path relative to the folder that contains it', () => {
    expect(relativeTo('C:\\w\\src\\a.go', ['C:\\other', 'c:\\W'])).toBe('W\\src\\a.go');
    expect(relativeTo('D:\\x\\a.go', ['C:\\w'])).toBe('D:\\x\\a.go');
  });
});

describe('file state', () => {
  const s0: FileState = emptyFileState();

  it('adds opened files once, newest first, without mutating', () => {
    const s1 = addOpened(s0, ['a', 'b']);
    const s2 = addOpened(s1, ['b', 'c']);
    expect(s2.opened).toEqual(['c', 'b', 'a']);
    expect(s1.opened).toEqual(['b', 'a']);
    expect(s0.opened).toEqual([]);
  });

  it('keeps recent files unique, newest first, capped', () => {
    let s = s0;
    for (let i = 0; i < 30; i++) s = addSeen(s, `f${i}`, 'Read');
    s = addSeen(s, 'f5', 'Edit');
    expect(s.seen).toHaveLength(20);
    expect(s.seen[0]).toEqual({ path: 'f5', tool: 'Edit' });
    expect(s.seen.filter((e) => e.path === 'f5')).toHaveLength(1);
  });
});
