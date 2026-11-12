// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangesPanel } from './changesPanel';

const DIFF = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,2 +1,2 @@', ' keep', '-old', '+new', ''].join('\n');

function setup(loadDiff = vi.fn(async () => DIFF)) {
  const openFile = vi.fn();
  const onLayout = vi.fn();
  const panel = new ChangesPanel({ loadDiff, openFile, onLayout });
  document.body.append(panel.el);
  return { panel, loadDiff, openFile, onLayout };
}

async function settle() {
  await vi.advanceTimersByTimeAsync(400);
}

describe('ChangesPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('stays hidden until the session changes a file', async () => {
    const { panel, onLayout } = setup();
    expect(panel.el.classList.contains('hidden')).toBe(true);
    panel.touched('C:\\w\\src\\a.ts', 'Edit');
    expect(panel.el.classList.contains('hidden')).toBe(false);
    expect(onLayout).toHaveBeenCalledTimes(1);
    await settle();
    expect(panel.el.querySelector('.changes-title')?.textContent).toBe('바뀐 파일 1');
    expect(panel.el.querySelector('.change-dir')?.textContent).toBe('src');
    expect(panel.el.querySelectorAll('.change-diff .diff-add')).toHaveLength(1);
    expect(panel.el.querySelectorAll('.change-diff .diff-del')).toHaveLength(1);
  });

  it('loads one diff for a burst of edits to the same file', async () => {
    const { panel, loadDiff } = setup();
    panel.touched('C:\\w\\a.ts', 'Edit');
    panel.touched('C:\\w\\a.ts', 'Edit');
    panel.touched('c:/w/a.ts', 'Edit');
    await settle();
    expect(loadDiff).toHaveBeenCalledTimes(1);
    expect(panel.el.querySelectorAll('.change-file')).toHaveLength(1);
  });

  it('reloads every file when the reply ends', async () => {
    const { panel, loadDiff } = setup();
    panel.touched('C:\\w\\a.ts', 'Edit');
    panel.touched('C:\\w\\b.ts', 'Write');
    await settle();
    panel.refreshAll();
    await settle();
    expect(loadDiff).toHaveBeenCalledTimes(4);
  });

  it('says so when the file matches the last commit, and shows load errors', async () => {
    const loadDiff = vi.fn().mockResolvedValueOnce('').mockRejectedValueOnce(new Error('git diff: boom'));
    const { panel } = setup(loadDiff);
    panel.touched('C:\\w\\a.ts', 'Edit');
    await settle();
    expect(panel.el.textContent).toContain('마지막 커밋과 같습니다');
    panel.refreshAll();
    await settle();
    expect(panel.el.textContent).toContain('git diff: boom');
  });

  it('opens the file from its name and remembers being collapsed', async () => {
    const { panel, openFile, onLayout } = setup();
    panel.touched('C:\\w\\a.ts', 'Edit');
    await settle();
    panel.el.querySelector<HTMLButtonElement>('.change-name')!.click();
    expect(openFile).toHaveBeenCalledWith('C:\\w\\a.ts');

    panel.el.querySelector<HTMLButtonElement>('.changes-toggle')!.click();
    await settle();
    expect(panel.el.classList.contains('collapsed')).toBe(true);
    expect(panel.el.querySelectorAll('.change-file')).toHaveLength(0);
    expect(onLayout).toHaveBeenCalledTimes(2);
    expect(setup().panel.el.classList.contains('collapsed')).toBe(true);
  });

  it('keeps a slow older diff from replacing a newer one', async () => {
    let finishFirst: (v: string) => void = () => {};
    const loadDiff = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((r) => (finishFirst = r)))
      .mockResolvedValueOnce(DIFF);
    const { panel } = setup(loadDiff);
    panel.touched('C:/w/a.ts', 'Edit');
    await settle(); // first load starts and hangs
    panel.touched('C:/w/a.ts', 'Edit');
    await settle(); // second load waits behind the first
    finishFirst(''); // the stale result: "unchanged"
    await settle();
    expect(loadDiff).toHaveBeenCalledTimes(2);
    expect(panel.el.textContent).not.toContain('마지막 커밋과 같습니다');
    expect(panel.el.querySelectorAll('.change-diff .diff-add')).toHaveLength(1);
  });

  it('folds older files when a new one arrives, but not ones the user opened or closed', async () => {
    const { panel } = setup();
    panel.touched('C:/w/a.ts', 'Edit');
    panel.touched('C:/w/b.ts', 'Edit');
    await settle();
    const open = () => [...panel.el.querySelectorAll('.change-file')].filter((f) => f.querySelector('.change-diff')).length;
    expect(open()).toBe(1); // only b.ts, the newest
    // The user folds b.ts; the next edit to it must not unfold it.
    panel.el.querySelector<HTMLButtonElement>('.change-caret')!.click();
    await settle();
    panel.touched('C:/w/b.ts', 'Edit');
    await settle();
    expect(open()).toBe(0);
  });

  it('calls an empty new file what it is', async () => {
    const { panel } = setup(vi.fn(async () => ['diff --git a/n b/n', 'new file', '--- /dev/null', '+++ b/n', ''].join('\n')));
    panel.touched('C:/w/n.ts', 'Write');
    await settle();
    expect(panel.el.textContent).toContain('빈 새 파일입니다');
  });

  it('stops updating after dispose', async () => {
    const { panel, loadDiff } = setup();
    panel.touched('C:\\w\\a.ts', 'Edit');
    panel.dispose();
    await settle();
    expect(loadDiff).not.toHaveBeenCalled();
  });
});
