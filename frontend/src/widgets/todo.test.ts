// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderTodo, type TodoItem } from './todo';

const item = (id: string, text: string, done = false): TodoItem => ({ id, text, done, created: '' });

function type(el: HTMLElement, text: string) {
  const input = el.querySelector('input.field') as HTMLInputElement;
  input.value = text;
  el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
}

describe('renderTodo', () => {
  it('lists open items first and counts what is done', () => {
    const el = renderTodo({ items: [item('a', '배포 확인', true), item('b', 'PR 리뷰 반영')] });
    const texts = [...el.querySelectorAll('.todo-text')].map((e) => e.textContent);
    expect(texts).toEqual(['PR 리뷰 반영', '배포 확인']);
    expect(el.textContent).toContain('1/2 완료');
  });

  it('adds, checks and deletes through the actions and redraws from the answer', async () => {
    const actions = {
      add: vi.fn(async () => [item('a', '새 일')]),
      setDone: vi.fn(async () => [item('a', '새 일', true)]),
      remove: vi.fn(async () => []),
    };
    const el = renderTodo({ items: [] }, actions);
    expect(el.textContent).toContain('오늘 할 일을 적어 보세요');
    type(el, '새 일');
    await vi.waitFor(() => expect(el.querySelectorAll('.todo-text')).toHaveLength(1));
    expect(actions.add).toHaveBeenCalledWith('새 일');
    const box = el.querySelector('input[type=checkbox]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change')); // what a click does in the browser
    await vi.waitFor(() => expect(el.querySelector('.todo-item.done')).not.toBeNull());
    expect(actions.setDone).toHaveBeenCalledWith('a', true);
    (el.querySelector('.todo-delete') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(el.querySelectorAll('.todo-text')).toHaveLength(0));
    expect(actions.remove).toHaveBeenCalledWith('a');
  });

  it('ignores an empty entry and shows a failed save', async () => {
    const actions = { add: vi.fn(async () => Promise.reject(new Error('저장 실패'))), setDone: vi.fn(), remove: vi.fn() };
    const el = renderTodo({ items: [] }, actions);
    type(el, '   ');
    expect(actions.add).not.toHaveBeenCalled();
    type(el, '일');
    await vi.waitFor(() => expect(el.textContent).toContain('저장 실패'));
  });
});
