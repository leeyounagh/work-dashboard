import { h } from './renderers';

/** One line of the "오늘 할 일" widget (as stored by the backend). */
export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  created: string;
  doneAt?: string;
}

/** Saves go through the backend, which answers with the whole list. */
export interface TodoActions {
  add(text: string): Promise<TodoItem[]>;
  setDone(id: string, done: boolean): Promise<TodoItem[]>;
  remove(id: string): Promise<TodoItem[]>;
}

/**
 * Today's to-dos: type and press Enter to add, tick when done, × to delete.
 * Done items stay for the day and are cleared by the backend the next day.
 */
export function renderTodo(d: { items: TodoItem[] | null }, actions?: TodoActions): HTMLElement {
  const box = h('div', 'w-list todo');
  const form = h('form', 'todo-add');
  const input = h('input', 'field');
  input.placeholder = '할 일 적고 Enter';
  input.maxLength = 200;
  input.disabled = !actions;
  form.append(input);
  const summary = h('div', 'w-summary');
  const list = h('div', 'todo-list');
  const error = h('p', 'error small');

  const draw = (items: TodoItem[]) => {
    const open = items.filter((t) => !t.done);
    const done = items.filter((t) => t.done);
    summary.textContent = items.length ? `${done.length}/${items.length} 완료` : '';
    if (!items.length) {
      list.replaceChildren(h('p', 'muted small', '오늘 할 일을 적어 보세요.'));
      return;
    }
    list.replaceChildren(...[...open, ...done].map(row));
  };

  // Every change redraws from the list the backend saved, so the card never
  // shows something that was not stored.
  const save = async (change: () => Promise<TodoItem[]>) => {
    error.textContent = '';
    try {
      draw(await change());
    } catch (err) {
      error.textContent = `저장하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`;
    }
  };

  const row = (t: TodoItem) => {
    const item = h('label', t.done ? 'todo-item done' : 'todo-item');
    const check = h('input');
    check.type = 'checkbox';
    check.checked = t.done;
    check.disabled = !actions;
    check.addEventListener('change', () => actions && void save(() => actions.setDone(t.id, check.checked)));
    const del = h('button', 'ghost todo-delete', '×');
    del.type = 'button';
    del.title = '삭제';
    del.disabled = !actions;
    del.addEventListener('click', (e) => {
      e.preventDefault(); // inside the label: don't toggle the checkbox
      if (actions) void save(() => actions.remove(t.id));
    });
    item.append(check, h('span', 'todo-text', t.text), del);
    return item;
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !actions) return;
    input.value = '';
    void save(() => actions.add(text));
  });

  draw(d.items ?? []);
  box.append(form, summary, list, error);
  return box;
}
