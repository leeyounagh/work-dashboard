// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { matches, searchableList } from './search';

const names = ['2026-10-22_그룹웨어_CSP_점검_리포트.html', '2026-10-21_allowBackup_설정_검토.html', 'PR1808-전자결재-첨부필수.md', '메모.txt'];

function render(key: string, limit = 2) {
  return searchableList({
    key,
    items: names,
    text: (n) => n,
    row: (n) => {
      const el = document.createElement('div');
      el.className = 'row';
      el.textContent = n;
      return el;
    },
    limit,
    placeholder: '문서 검색',
  });
}

const shown = (el: HTMLElement) => [...el.querySelectorAll('.row')].map((r) => r.textContent);

function type(el: HTMLElement, q: string) {
  const input = el.querySelector('input')!;
  input.value = q;
  input.dispatchEvent(new Event('input'));
}

describe('matches', () => {
  it('needs every word, ignoring case, _ and -', () => {
    expect(matches(names[0], 'csp 리포트')).toBe(true);
    expect(matches(names[0], 'CSP 그룹웨어')).toBe(true);
    expect(matches(names[0], 'csp 메일')).toBe(false);
    expect(matches(names[2], '전자결재 첨부')).toBe(true);
    expect(matches(names[1], 'allowbackup')).toBe(true);
    expect(matches(names[1], '')).toBe(true);
  });
});

describe('searchableList', () => {
  it('shows the first items until a search, then every match', () => {
    const el = render('a');
    expect(shown(el)).toEqual(names.slice(0, 2));
    expect(el.textContent).toContain('4개 중 2개');
    type(el, '첨부');
    expect(shown(el)).toEqual([names[2]]);
    expect(el.textContent).toContain('검색 결과 1개');
    type(el, '없는말');
    expect(shown(el)).toEqual([]);
    expect(el.textContent).toContain('찾는 문서가 없습니다');
  });

  it('keeps the search when the widget re-renders', () => {
    type(render('keep'), 'allowbackup');
    const again = render('keep');
    expect(again.querySelector('input')!.value).toBe('allowbackup');
    expect(shown(again)).toEqual([names[1]]);
  });
});
