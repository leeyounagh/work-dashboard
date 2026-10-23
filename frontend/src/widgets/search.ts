import { h } from './renderers';

/** Most rows drawn for one search, so a broad query stays quick. */
const MAX_RESULTS = 200;

// The query of each list survives the widget's periodic reloads.
const queries = new Map<string, string>();

const normalize = (text: string) => text.normalize('NFC').toLowerCase().replace(/[_\-.]+/g, ' ');

/** Whether text contains every word of the query (case, _ - . ignored). */
export function matches(text: string, query: string): boolean {
  const hay = normalize(text);
  return normalize(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

interface SearchOptions<T> {
  key: string; // identifies the list across re-renders
  items: T[];
  text: (item: T) => string;
  row: (item: T) => HTMLElement;
  limit?: number; // rows shown while not searching (default: all)
  placeholder: string;
}

/**
 * A list with a search box: without a query it shows the first `limit`
 * items, with one every match (up to MAX_RESULTS).
 */
export function searchableList<T>({ key, items, text, row, limit, placeholder }: SearchOptions<T>): HTMLElement {
  const box = h('div', 'w-search-list');
  const input = h('input', 'field w-search');
  input.type = 'search';
  input.placeholder = placeholder;
  input.value = queries.get(key) ?? '';
  input.setAttribute('aria-label', placeholder);
  const summary = h('div', 'w-summary');
  const list = h('div', 'w-list');

  const update = () => {
    const query = input.value.trim();
    if (query) queries.set(key, input.value);
    else queries.delete(key);
    const found = query ? items.filter((item) => matches(text(item), query)) : items;
    const visible = found.slice(0, query ? MAX_RESULTS : (limit ?? found.length));
    if (query) summary.textContent = found.length ? `검색 결과 ${found.length}개` : '찾는 문서가 없습니다.';
    else summary.textContent = visible.length < items.length ? `${items.length}개 중 ${visible.length}개` : `${items.length}개`;
    list.replaceChildren(...visible.map(row));
  };
  input.addEventListener('input', update);
  update();
  box.append(input, summary, list);
  return box;
}
