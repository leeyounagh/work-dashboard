import { describe, expect, it } from 'vitest';
import { isEditTool, parseDiff, touch } from './changeState';

describe('isEditTool', () => {
  it.each([
    ['Edit', true],
    ['Write', true],
    ['MultiEdit', true],
    ['NotebookEdit', true],
    ['Read', false],
    ['Bash', false],
    [undefined, false],
  ])('%s → %s', (tool, want) => {
    expect(isEditTool(tool)).toBe(want);
  });
});

describe('touch', () => {
  it('puts the newest first and keeps one entry per path', () => {
    let list = touch([], 'C:\\w\\a.ts', 'Edit');
    list = touch(list, 'C:\\w\\b.ts', 'Write');
    list = touch(list, 'C:/w/A.ts', 'Edit'); // same file, other spelling
    expect(list.map((f) => f.path)).toEqual(['C:/w/A.ts', 'C:\\w\\b.ts']);
  });

  it('does not change the list it was given', () => {
    const list = touch([], 'a', 'Edit');
    touch(list, 'b', 'Edit');
    expect(list).toHaveLength(1);
  });
});

describe('parseDiff', () => {
  const diff = [
    'diff --git a/x.go b/x.go',
    'index 1..2 100644',
    '--- a/x.go',
    '+++ b/x.go',
    '@@ -3,3 +3,4 @@ func main() {',
    ' a',
    '-b',
    '+c',
    '+d',
    ' e',
    '\\ No newline at end of file',
    '',
  ].join('\n');

  it('counts added and removed lines, not the file headers', () => {
    const d = parseDiff(diff);
    expect(d.added).toBe(2);
    expect(d.removed).toBe(1);
    expect(d.isNew).toBe(false);
  });

  it('numbers lines from the hunk header', () => {
    const d = parseDiff(diff);
    expect(d.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['hunk', undefined, undefined],
      ['ctx', 3, 3],
      ['del', 4, undefined],
      ['add', undefined, 4],
      ['add', undefined, 5],
      ['ctx', 5, 6],
      ['note', undefined, undefined],
    ]);
  });

  it('reads a new file and CRLF output', () => {
    const d = parseDiff('diff --git a/n b/n\r\nnew file\r\n--- /dev/null\r\n+++ b/n\r\n@@ -0,0 +1,2 @@\r\n+one\r\n+two\r\n');
    expect(d.isNew).toBe(true);
    expect(d.added).toBe(2);
    expect(d.lines[1]).toEqual({ kind: 'add', text: 'one', newNo: 1 });
  });

  it('marks binary files and an empty diff', () => {
    expect(parseDiff('diff --git a/p b/p\nBinary files a/p and b/p differ\n').binary).toBe(true);
    expect(parseDiff('')).toEqual({ lines: [], added: 0, removed: 0, isNew: false, binary: false });
  });
});
