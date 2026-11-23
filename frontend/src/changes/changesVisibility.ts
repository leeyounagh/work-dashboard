const HIDDEN_KEY = 'work-dashboard.changesHidden';
/** On the terminal area: hides every Claude tab's changed-files panel. */
export const CHANGES_OFF_CLASS = 'changes-off';

/** Whether the user turned the changed-files panel off (remembered across runs). */
export function loadChangesHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveChangesHidden(hidden: boolean): void {
  try {
    localStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0');
  } catch {
    // Not fatal: the choice just isn't remembered.
  }
}

/** Shows the on/off state on the toolbar button. */
export function paintChangesButton(button: HTMLButtonElement, hidden: boolean): void {
  button.setAttribute('aria-pressed', String(!hidden));
  button.classList.toggle('active', !hidden);
  button.title = hidden ? 'Claude 탭 오른쪽에 바뀐 파일 보이기' : '바뀐 파일 패널 끄기';
}
