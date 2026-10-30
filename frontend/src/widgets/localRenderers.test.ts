// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderLocal } from './localRenderers';

const open = vi.fn();

describe('renderLocal', () => {
  it('flags stale worktrees and errors', () => {
    const el = renderLocal('worktrees', {
      baseRef: 'origin/test',
      items: [
        { path: 'C:\\r\\.worktrees\\old', branch: 'feature/old', ahead: 2, behind: 793, dirty: 3, stale: true, detached: false },
        { path: 'C:\\r', branch: 'main', ahead: 0, behind: 0, dirty: 0, stale: false, detached: false, error: 'unknown ref' },
      ],
      errors: ['other: not a git repo'],
    }, open)!;
    expect(el.textContent).toContain('↓793');
    expect(el.textContent).toContain('낡음');
    expect(el.textContent).toContain('변경 3');
    expect(el.textContent).toContain('unknown ref');
    expect(el.textContent).toContain('not a git repo');
  });

  it('renders Linear issues and Notion pages with the cache note', () => {
    const lin = renderLocal('linear-issues', { issues: [{ id: 'GRO-1', title: '제목', state: 'In Review', team: 'GRO', url: 'https://linear.app/x', priority: 'High' }], fetchedAt: '2026-10-23T01:00:00Z', costUsd: 0.018 }, open)!;
    expect(lin.textContent).toContain('GRO-1');
    expect(lin.textContent).toContain('30분 캐시');
    lin.querySelector<HTMLButtonElement>('.w-pr-num')!.click();
    expect(open).toHaveBeenCalledWith('https://linear.app/x');
    const notion = renderLocal('notion-specs', { pages: [{ id: 'p', title: '근태 명세', url: '', version: 'Ver 1.2.0', lastEdited: '' }], fetchedAt: '', costUsd: 0 }, open)!;
    expect(notion.textContent).toContain('Ver 1.2.0');
  });

  it('renders Teams deploy cards with my PRs marked and shared redeploys counted', () => {
    const pr = (number: number, author: string, shared = false) => ({ number, title: `PR ${number}`, author, url: `https://github.com/o/r/pull/${number}`, shared });
    const card = (id: string, env: string, status: string, prs: ReturnType<typeof pr>[]) => ({ id, createdAt: '2026-10-29T14:17:05Z', webUrl: 'https://teams.microsoft.com/l/message/x', status, tag: 'groupware', env, image: '1.0.496', prs });
    const el = renderLocal(
      'teams-deploy',
      { cards: [card('1', 'TEST', '✅', [pr(2023, 'LeeYounagh'), pr(1765, 'other', true)]), card('2', 'PROD', '❌', [pr(7, 'other')])], tags: ['groupware'], me: 'leeyounagh', fetchedAt: '', costUsd: 0.02 },
      open,
    )!;
    expect(el.querySelector('.w-summary')?.textContent).toBe('groupware · 2건');
    const [ok, failed] = el.querySelectorAll('.w-item');
    expect(ok.textContent).toContain('내 PR 포함');
    expect(ok.textContent).toContain('공유 코드로 함께 재배포된 PR 1건');
    expect(ok.textContent).not.toContain('PR 1765');
    expect(failed.classList.contains('attention')).toBe(true);
    expect(failed.textContent).not.toContain('내 PR');
    ok.querySelector<HTMLButtonElement>('.w-pr-num')!.click();
    expect(open).toHaveBeenCalledWith('https://github.com/o/r/pull/2023');
    const empty = renderLocal('teams-deploy', { cards: null, tags: null, me: '', fetchedAt: '', costUsd: 0 }, open)!;
    expect(empty.textContent).toContain('전체 서비스 · 0건');
  });

  it('groups my Linear issues with work to do first', () => {
    const issue = (id: string, state: string, group: string) => ({ id, title: id, state, group, team: 'GRO', url: '', priority: '' });
    const el = renderLocal(
      'linear-issues',
      { issues: [issue('GRO-1', 'Todo', 'todo'), issue('GRO-2', 'In Progress', 'doing'), issue('GRO-3', 'In Review', 'review'), issue('GRO-4', 'Test Passed', 'review')], fetchedAt: '', costUsd: 0 },
      open,
    )!;
    const heads = [...el.querySelectorAll('.w-section')].map((e) => e.textContent);
    expect(heads).toEqual(['할 일 1', '진행 중 1', '리뷰·확인 중 2']);
  });

  it('wires QA and session buttons to actions', () => {
    const actions = { startQA: vi.fn(), resume: vi.fn() };
    const qa = renderLocal('qa-2pass', { domain: 'groupware', features: ['근태'], modes: ['1차', '2차'], reports: [] }, open, actions)!;
    qa.querySelectorAll<HTMLButtonElement>('button')[1].click();
    expect(actions.startQA).toHaveBeenCalledWith('근태', '2차');

    const ses = renderLocal('session-restore', {
      recent: [
        { sessionId: 's1', title: '휴가 버그', lastActive: '2026-10-23T01:00:00Z', open: false },
        { sessionId: 's2', title: '실행 중인 것', lastActive: '2026-10-23T01:00:00Z', open: true },
      ],
      resumeClaude: true,
    }, open, actions)!;
    const buttons = ses.querySelectorAll<HTMLButtonElement>('button');
    expect(buttons).toHaveLength(1); // the running session has no resume button
    buttons[0].click();
    expect(actions.resume).toHaveBeenCalledWith('s1');
  });

  it('returns null for other widget types', () => {
    expect(renderLocal('pr-reviews', {}, open)).toBeNull();
  });

  it('lists folder documents and opens one on click', () => {
    const openFile = vi.fn();
    const el = renderLocal(
      'folder-files',
      {
        folder: 'C:\docs',
        total: 3,
        limit: 2,
        files: [
          { name: '2026-10-23_새_문서.html', modified: '2026-10-23T09:00:00Z', size: 2048 },
          { name: '메모.md', modified: '2026-10-20T09:00:00Z', size: 10 },
          { name: '오래된.md', modified: '2026-10-10T09:00:00Z', size: 10 },
        ],
      },
      open,
      { startQA: vi.fn(), resume: vi.fn(), openFile },
    )!;
    expect(el.textContent).toContain('2026-10-23_새_문서.html');
    expect(el.textContent).toContain('3개 중 2개');
    el.querySelector<HTMLButtonElement>('button.w-file')!.click();
    expect(openFile).toHaveBeenCalledWith('2026-10-23_새_문서.html');
    // The search covers files beyond the shown ones.
    const input = el.querySelector('input')!;
    input.value = '오래된';
    input.dispatchEvent(new Event('input'));
    expect([...el.querySelectorAll('button.w-file')].map((b) => b.textContent)).toEqual(['오래된.md']);
  });

  it('says so when a folder has no documents', () => {
    const el = renderLocal('folder-files', { folder: 'C:\docs', total: 0, limit: 20, files: null }, open)!;
    expect(el.textContent).toContain('문서가 없습니다');
  });
});
