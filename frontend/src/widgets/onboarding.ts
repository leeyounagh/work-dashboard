import { h } from './renderers';

/**
 * A new workspace starts with only the widgets that work without setup
 * (chosen by the backend from git, GitHub and the gh login). The first time
 * it is shown, a short note says so and points to 위젯 관리, where Linear,
 * Notion, deploy status, QA and Claude's suggestions are.
 */

const key = (workspaceId: string) => `wd.welcome.${workspaceId}`;

function store(action: (s: Storage) => void): void {
  try {
    action(localStorage);
  } catch {
    // Storage may be blocked; the note is only a convenience.
  }
}

export function markNewWorkspace(workspaceId: string): void {
  store((s) => s.setItem(key(workspaceId), '1'));
}

export function showsWelcome(workspaceId: string): boolean {
  try {
    return localStorage.getItem(key(workspaceId)) === '1';
  } catch {
    return false;
  }
}

export function dismissWelcome(workspaceId: string): void {
  store((s) => s.removeItem(key(workspaceId)));
}

export function renderWelcome(onManage: () => void, onClose: () => void): HTMLElement {
  const box = h('div', 'w-welcome');
  box.append(
    h('p', 'small', '이 컴퓨터에서 바로 쓸 수 있는 위젯만 켰습니다 (git · GitHub 로그인 · Claude 기준).'),
    h('p', 'muted small', 'Linear · Notion · 배포 상태 · QA 와 직접 만드는 위젯, Claude 추천은 「위젯 관리」에 있습니다.'),
  );
  const actions = h('div', 'w-inline-actions');
  const manage = h('button', 'primary small-btn', '위젯 관리 열기');
  manage.type = 'button';
  manage.addEventListener('click', onManage);
  const close = h('button', 'ghost small-btn', '닫기');
  close.type = 'button';
  close.addEventListener('click', onClose);
  actions.append(manage, close);
  box.append(actions);
  return box;
}
